'use strict';

const agg = require('../../core/aggregator');
const { assistantWhere, sessionWhere } = require('./sources');

const TOKEN_PATHS = {
  input: [
    '$.tokens.input', '$.tokens.inputTokens', '$.tokens.input_tokens',
    '$.tokens.prompt_tokens', '$.tokens.promptTokens',
    '$.usage.input', '$.usage.inputTokens', '$.usage.input_tokens',
    '$.usage.prompt_tokens', '$.usage.promptTokens',
  ],
  output: [
    '$.tokens.output', '$.tokens.outputTokens', '$.tokens.output_tokens',
    '$.tokens.completion_tokens', '$.tokens.completionTokens',
    '$.usage.output', '$.usage.outputTokens', '$.usage.output_tokens',
    '$.usage.completion_tokens', '$.usage.completionTokens',
  ],
  reasoning: [
    '$.tokens.reasoning', '$.tokens.reasoningTokens', '$.tokens.reasoning_tokens',
    '$.usage.reasoning', '$.usage.reasoningTokens', '$.usage.reasoning_tokens',
  ],
  cacheRead: [
    '$.tokens.cache.read', '$.tokens.cache.cache_read',
    '$.tokens.cacheRead', '$.tokens.cache_read',
    '$.tokens.cached_tokens', '$.tokens.cache_read_tokens',
    '$.usage.cache.read', '$.usage.cache.cache_read',
    '$.usage.cacheRead', '$.usage.cache_read',
    '$.usage.cached_tokens', '$.usage.cache_read_tokens',
  ],
  cacheWrite: [
    '$.tokens.cache.write', '$.tokens.cache.cache_write',
    '$.tokens.cacheWrite', '$.tokens.cache_write',
    '$.tokens.cache_creation_input_tokens', '$.tokens.cache_write_tokens',
    '$.usage.cache.write', '$.usage.cache.cache_write',
    '$.usage.cacheWrite', '$.usage.cache_write',
    '$.usage.cache_creation_input_tokens', '$.usage.cache_write_tokens',
  ],
  total: [
    '$.tokens.total', '$.tokens.totalTokens', '$.tokens.total_tokens',
    '$.usage.total', '$.usage.totalTokens', '$.usage.total_tokens',
  ],
};

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sqlNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function jsonNumberExpr(alias, paths) {
  return `coalesce(${paths.map((p) => `nullif(cast(json_extract(${alias}.data, '${p}') as real), 0)`).join(', ')}, 0)`;
}

function tokenFieldExpr(alias, field) {
  if (field !== 'total') return jsonNumberExpr(alias, TOKEN_PATHS[field]);
  const explicit = jsonNumberExpr(alias, TOKEN_PATHS.total);
  const sum = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'].map((k) => tokenFieldExpr(alias, k)).join(' + ');
  return `coalesce(nullif((${explicit}), 0), (${sum}), 0)`;
}

function timeExpr(alias, jsonPath, column) {
  return `coalesce(nullif(cast(json_extract(${alias}.data, '${jsonPath}') as real), 0), ${alias}.${column})`;
}

function assistantTokenCtes(tables = [], whereSql = '1=1') {
  const hasPart = tables.includes('part');
  const ctes = [];
  if (hasPart) {
    ctes.push(`part_tokens as (
      select
        p.message_id,
        sum(${tokenFieldExpr('p', 'total')}) as total,
        sum(${tokenFieldExpr('p', 'input')}) as input,
        sum(${tokenFieldExpr('p', 'output')}) as output,
        sum(${tokenFieldExpr('p', 'reasoning')}) as reasoning,
        sum(${tokenFieldExpr('p', 'cacheRead')}) as cacheRead,
        sum(${tokenFieldExpr('p', 'cacheWrite')}) as cacheWrite
      from part p
      where json_extract(p.data, '$.type') = 'step-finish'
        and (json_type(p.data, '$.tokens') is not null or json_type(p.data, '$.usage') is not null)
      group by p.message_id
    )`);
  }
  ctes.push(`assistant_tokens as (
    select
      m.id,
      m.session_id,
      m.time_created,
      m.time_updated,
      m.data,
      ${hasPart ? `coalesce(pt.total, ${tokenFieldExpr('m', 'total')})` : tokenFieldExpr('m', 'total')} as total,
      ${hasPart ? `coalesce(pt.input, ${tokenFieldExpr('m', 'input')})` : tokenFieldExpr('m', 'input')} as input,
      ${hasPart ? `coalesce(pt.output, ${tokenFieldExpr('m', 'output')})` : tokenFieldExpr('m', 'output')} as output,
      ${hasPart ? `coalesce(pt.reasoning, ${tokenFieldExpr('m', 'reasoning')})` : tokenFieldExpr('m', 'reasoning')} as reasoning,
      ${hasPart ? `coalesce(pt.cacheRead, ${tokenFieldExpr('m', 'cacheRead')})` : tokenFieldExpr('m', 'cacheRead')} as cacheRead,
      ${hasPart ? `coalesce(pt.cacheWrite, ${tokenFieldExpr('m', 'cacheWrite')})` : tokenFieldExpr('m', 'cacheWrite')} as cacheWrite,
      case when json_type(m.data, '$.error') is null then 0 else 1 end as error,
      coalesce(json_extract(m.data, '$.providerID'), json_extract(m.data, '$.model.providerID'), 'unknown') as provider,
      coalesce(json_extract(m.data, '$.modelID'), json_extract(m.data, '$.model.modelID'), 'unknown') as model,
      ${timeExpr('m', '$.time.created', 'time_created')} as message_created,
      ${timeExpr('m', '$.time.completed', 'time_updated')} as message_completed
    from message m
    ${hasPart ? 'left join part_tokens pt on pt.message_id = m.id' : ''}
    where ${whereSql}
  )`);
  return `with ${ctes.join(',\n')}`;
}

function usageSelect(prefix, predicate = '1=1') {
  const guard = predicate ? `case when ${predicate} then` : '';
  const end = predicate ? ' else 0 end' : '';
  const oneEnd = predicate ? ' else 0 end' : '';
  return [
    `sum(${guard} total${end}) as ${prefix}_total`,
    `sum(${guard} input${end}) as ${prefix}_input`,
    `sum(${guard} output${end}) as ${prefix}_output`,
    `sum(${guard} reasoning${end}) as ${prefix}_reasoning`,
    `sum(${guard} cacheRead${end}) as ${prefix}_cacheRead`,
    `sum(${guard} cacheWrite${end}) as ${prefix}_cacheWrite`,
    `sum(${predicate ? `case when ${predicate} then 1${oneEnd}` : '1'}) as ${prefix}_messages`,
    `sum(${guard} error${end}) as ${prefix}_errors`,
  ].join(',\n');
}

function usageFromRow(row = {}, prefix) {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: sqlNumber(row[`${prefix}_total`]),
    input: sqlNumber(row[`${prefix}_input`]),
    output: sqlNumber(row[`${prefix}_output`]),
    reasoning: sqlNumber(row[`${prefix}_reasoning`]),
    cacheRead: sqlNumber(row[`${prefix}_cacheRead`]),
    cacheWrite: sqlNumber(row[`${prefix}_cacheWrite`]),
    messages: sqlNumber(row[`${prefix}_messages`]),
    errors: sqlNumber(row[`${prefix}_errors`]),
  });
}

function rowUsage(row = {}) {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: sqlNumber(row.total),
    input: sqlNumber(row.input),
    output: sqlNumber(row.output),
    reasoning: sqlNumber(row.reasoning),
    cacheRead: sqlNumber(row.cacheRead),
    cacheWrite: sqlNumber(row.cacheWrite),
    messages: sqlNumber(row.messages),
    errors: sqlNumber(row.errors),
  });
}

function summaryForSourceSql({ source, db, tables, queryAll, payload, windows }) {
  const { where, params } = assistantWhere(payload);
  const sql = `${assistantTokenCtes(tables, where)}
    select
      ${usageSelect('today', `time_created >= ${safeNumber(windows.dayStartMs)}`)},
      ${usageSelect('window', `time_created >= ${safeNumber(windows.windowStartMs)}`)},
      ${usageSelect('week', `time_created >= ${safeNumber(windows.weekStartMs)}`)},
      ${usageSelect('all', '1=1')}
    from assistant_tokens`;
  const row = queryAll(db, sql, params)[0] || {};
  return {
    source: { id: source.id, label: source.label, dbPath: source.dbPath },
    usage: {
      today: usageFromRow(row, 'today'),
      window: usageFromRow(row, 'window'),
      week: usageFromRow(row, 'week'),
      all: usageFromRow(row, 'all'),
    },
  };
}

function trendForSourceSql({ db, tables, queryAll, payload, trendRange }) {
  const bucketMs = Math.max(60000, safeNumber(trendRange.bucketMs, 3600000));
  const { where, params } = assistantWhere({ ...payload, range: { start: trendRange.start, end: trendRange.end } });
  const sql = `${assistantTokenCtes(tables, where)},
    bucketed as (
      select
        cast(time_created / ${bucketMs} as integer) * ${bucketMs} as bucket,
        total, input, output, reasoning, cacheRead, cacheWrite, error,
        case when message_completed >= message_created and message_created > 0 then message_completed - message_created else null end as latency
      from assistant_tokens
    )
    select
      bucket as start,
      bucket + ${bucketMs} as end,
      sum(total) as total,
      sum(input) as input,
      sum(output) as output,
      sum(reasoning) as reasoning,
      sum(cacheRead) as cacheRead,
      sum(cacheWrite) as cacheWrite,
      count(*) as messages,
      sum(error) as errors,
      avg(latency) as latencyAvg,
      max(latency) as latencyP95
    from bucketed
    group by bucket
    order by bucket asc`;
  return queryAll(db, sql, params).map((row) => agg.cacheMetrics.withCacheHitMetrics({
    start: sqlNumber(row.start),
    end: sqlNumber(row.end),
    total: sqlNumber(row.total),
    input: sqlNumber(row.input),
    output: sqlNumber(row.output),
    reasoning: sqlNumber(row.reasoning),
    cacheRead: sqlNumber(row.cacheRead),
    cacheWrite: sqlNumber(row.cacheWrite),
    messages: sqlNumber(row.messages),
    errors: sqlNumber(row.errors),
    latencyAvg: row.latencyAvg == null ? null : Number(row.latencyAvg),
    latencyP95: row.latencyP95 == null ? null : Number(row.latencyP95),
    label: new Date(sqlNumber(row.start)).toLocaleString('zh-CN', { hour12: false }),
  }));
}

function sourceStatForSourceSql({ source, db, tables, queryAll, payload }) {
  const range = payload.range || {};
  const { where, params } = assistantWhere({ ...payload, range });
  const sql = `${assistantTokenCtes(tables, where)}
    select
      ${usageSelect('scope', '1=1')}
    from assistant_tokens`;
  const row = queryAll(db, sql, params)[0] || {};
  return {
    key: source.id,
    source: source.id,
    label: source.label,
    requests: sqlNumber(row.scope_messages),
    ...usageFromRow(row, 'scope'),
  };
}

function modelStatsForSourceSql({ source, db, tables, queryAll, payload }) {
  const range = payload.range || {};
  const { where, params } = assistantWhere({ ...payload, range });
  const sql = `${assistantTokenCtes(tables, where)},
    model_rows as (
      select
        provider,
        model,
        total, input, output, reasoning, cacheRead, cacheWrite, error,
        case when message_completed >= message_created and message_created > 0 then message_completed - message_created else null end as latency
      from assistant_tokens
    )
    select
      provider,
      model,
      sum(total) as total,
      sum(input) as input,
      sum(output) as output,
      sum(reasoning) as reasoning,
      sum(cacheRead) as cacheRead,
      sum(cacheWrite) as cacheWrite,
      count(*) as messages,
      sum(error) as errors,
      count(latency) as latencyCount,
      min(latency) as latencyMin,
      avg(latency) as latencyAvg,
      max(latency) as latencyMax
    from model_rows
    group by provider, model
    order by total desc`;
  return queryAll(db, sql, params).map((row) => {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const latency = {
      count: sqlNumber(row.latencyCount),
      min: row.latencyMin == null ? null : Number(row.latencyMin),
      avg: row.latencyAvg == null ? null : Number(row.latencyAvg),
      p50: null,
      p90: null,
      p95: null,
      p99: null,
      max: row.latencyMax == null ? null : Number(row.latencyMax),
    };
    return {
      name: `${provider} / ${model}`,
      provider,
      model,
      ...rowUsage(row),
      source: source.id,
      sourceLabel: source.label,
      performance: {
        latency,
        ttft: agg.summarize([]),
        firstContentApprox: agg.summarize([]),
        outputTokensPerSec: agg.summarize([]),
        totalTokensPerSec: agg.summarize([]),
      },
    };
  });
}

function sessionSummaryForSourceSql({ source, db, queryAll, payload }) {
  const basePayload = { ...payload, status: 'all' };
  const { where, params } = sessionWhere(basePayload);
  const weekAgo = safeNumber(payload.timestamp || Date.now()) - 7 * 86400000;
  const totalRow = queryAll(db, `select
      count(*) as total,
      sum(case when time_archived is null then 1 else 0 end) as active,
      sum(case when time_archived is not null then 1 else 0 end) as archived,
      sum(case when time_updated >= ? then 1 else 0 end) as recent7d
    from session
    where ${where}`, [weekAgo, ...params])[0] || {};
  const projectRows = queryAll(db, `select
      coalesce(directory, '') as directory,
      count(*) as count,
      sum(case when time_archived is null then 1 else 0 end) as active,
      sum(case when time_archived is not null then 1 else 0 end) as archived,
      max(time_updated) as updatedAt
    from session
    where ${where}
    group by coalesce(directory, '')
    order by count desc, updatedAt desc
    limit 20`, params);
  return {
    source: source.id,
    sourceLabel: source.label,
    total: sqlNumber(totalRow.total),
    active: sqlNumber(totalRow.active),
    archived: sqlNumber(totalRow.archived),
    recent7d: sqlNumber(totalRow.recent7d),
    projects: projectRows.map((row) => ({
      key: row.directory || '__none',
      directory: row.directory || '',
      count: sqlNumber(row.count),
      active: sqlNumber(row.active),
      archived: sqlNumber(row.archived),
      updatedAt: sqlNumber(row.updatedAt),
    })),
  };
}

function aggregateBundleForSourceSql(args) {
  return {
    source: { id: args.source.id, label: args.source.label, dbPath: args.source.dbPath },
    summary: summaryForSourceSql(args),
    sourceStat: sourceStatForSourceSql(args),
    modelStats: modelStatsForSourceSql(args),
    trendBuckets: trendForSourceSql(args),
    sessionSummary: sessionSummaryForSourceSql(args),
  };
}

module.exports = {
  summaryForSourceSql,
  trendForSourceSql,
  sourceStatForSourceSql,
  modelStatsForSourceSql,
  sessionSummaryForSourceSql,
  aggregateBundleForSourceSql,
};
