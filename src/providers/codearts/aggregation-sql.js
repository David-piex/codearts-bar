'use strict';

const agg = require('../../core/aggregator');
const { assistantWhere, sessionWhere, resolveTimestamp } = require('./sources');

const {
  safeNumber,
  sqlNumber,
  assistantTokenCtes,
  usageColumns,
  usageSelect,
  usageFromRow,
  rowUsage,
  usageFromAggregateRow,
} = require('./aggregation-sql-expressions');

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
  const bucketOffsetMs = safeNumber(trendRange.bucketOffsetMs, 0);
  const bucketExpression = `cast((time_created + ${bucketOffsetMs}) / ${bucketMs} as integer) * ${bucketMs} - ${bucketOffsetMs}`;
  const { where, params } = assistantWhere({ ...payload, range: { start: trendRange.start, end: trendRange.end } });
  const sql = `${assistantTokenCtes(tables, where)},
    bucketed as (
      select
        ${bucketExpression} as bucket,
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
  const weekAgo = resolveTimestamp(payload) - 7 * 86400000;
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

function sessionRowsForSourceSql({ db, queryAll }) {
  return queryAll(db, `select
      id,
      title,
      directory,
      time_created as timeCreated,
      time_updated as timeUpdated,
      time_archived as timeArchived
    from session`, []).map((row) => ({
    id: row.id,
    title: row.title || '',
    directory: row.directory || '',
    timeCreated: sqlNumber(row.timeCreated),
    timeUpdated: sqlNumber(row.timeUpdated),
    timeArchived: row.timeArchived == null ? null : sqlNumber(row.timeArchived),
  }));
}

function aggregateBundleRowsForSourceSql({ db, tables, queryAll, payload, windows, trendRange }) {
  const bucketMs = Math.max(60000, safeNumber(trendRange.bucketMs, 3600000));
  const bucketOffsetMs = safeNumber(trendRange.bucketOffsetMs, 0);
  const bucketExpression = `cast((time_created + ${bucketOffsetMs}) / ${bucketMs} as integer) * ${bucketMs} - ${bucketOffsetMs}`;
  const trendStart = safeNumber(trendRange.start);
  const trendEnd = safeNumber(trendRange.end);
  const { where, params } = assistantWhere(payload);
  const metricColumns = `
      null as key,
      null as label,
      null as provider,
      null as model,
      null as start,
      null as end`;
  const sql = `${assistantTokenCtes(tables, where, { materialized: true })},
    token_rows as materialized (
      select
        *,
        case when message_completed >= message_created and message_created > 0 then message_completed - message_created else null end as latency
      from assistant_tokens
    )
    select
      'summary_today' as kind,
      ${metricColumns},
      ${usageColumns(`time_created >= ${safeNumber(windows.dayStartMs)}`)},
      null as latencyCount,
      null as latencyMin,
      null as latencyAvg,
      null as latencyMax,
      null as latencyP95
    from token_rows
    union all
    select
      'summary_window' as kind,
      ${metricColumns},
      ${usageColumns(`time_created >= ${safeNumber(windows.windowStartMs)}`)},
      null as latencyCount,
      null as latencyMin,
      null as latencyAvg,
      null as latencyMax,
      null as latencyP95
    from token_rows
    union all
    select
      'summary_week' as kind,
      ${metricColumns},
      ${usageColumns(`time_created >= ${safeNumber(windows.weekStartMs)}`)},
      null as latencyCount,
      null as latencyMin,
      null as latencyAvg,
      null as latencyMax,
      null as latencyP95
    from token_rows
    union all
    select
      'summary_all' as kind,
      ${metricColumns},
      ${usageColumns('1=1')},
      null as latencyCount,
      null as latencyMin,
      null as latencyAvg,
      null as latencyMax,
      null as latencyP95
    from token_rows
    union all
    select
      'sourceStat' as kind,
      ${metricColumns},
      ${usageColumns('1=1')},
      null as latencyCount,
      null as latencyMin,
      null as latencyAvg,
      null as latencyMax,
      null as latencyP95
    from token_rows
    union all
    select
      'model' as kind,
      provider || ' / ' || model as key,
      null as label,
      provider,
      model,
      null as start,
      null as end,
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
      max(latency) as latencyMax,
      null as latencyP95
    from token_rows
    group by provider, model
    union all
    select
      'trend' as kind,
      ${bucketExpression} as key,
      null as label,
      null as provider,
      null as model,
      ${bucketExpression} as start,
      ${bucketExpression} + ${bucketMs} as end,
      sum(total) as total,
      sum(input) as input,
      sum(output) as output,
      sum(reasoning) as reasoning,
      sum(cacheRead) as cacheRead,
      sum(cacheWrite) as cacheWrite,
      count(*) as messages,
      sum(error) as errors,
      count(latency) as latencyCount,
      null as latencyMin,
      avg(latency) as latencyAvg,
      null as latencyMax,
      max(latency) as latencyP95
    from token_rows
    where time_created >= ${trendStart} and time_created < ${trendEnd}
    group by ${bucketExpression}`;
  return queryAll(db, sql, params);
}

function aggregateBundleForSourceSql(args) {
  const rows = aggregateBundleRowsForSourceSql(args);
  const byKind = new Map();
  for (const row of rows) {
    const kind = row.kind || '';
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(row);
  }
  const firstUsage = (kind) => usageFromAggregateRow((byKind.get(kind) || [])[0] || {});
  const sourceStatUsage = firstUsage('sourceStat');
  const modelStats = (byKind.get('model') || []).map((row) => {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    return {
      name: `${provider} / ${model}`,
      provider,
      model,
      ...usageFromAggregateRow(row),
      source: args.source.id,
      sourceLabel: args.source.label,
      performance: {
        latency: {
          count: sqlNumber(row.latencyCount),
          min: row.latencyMin == null ? null : Number(row.latencyMin),
          avg: row.latencyAvg == null ? null : Number(row.latencyAvg),
          p50: null,
          p90: null,
          p95: null,
          p99: null,
          max: row.latencyMax == null ? null : Number(row.latencyMax),
        },
        ttft: agg.summarize([]),
        firstContentApprox: agg.summarize([]),
        outputTokensPerSec: agg.summarize([]),
        totalTokensPerSec: agg.summarize([]),
      },
    };
  }).sort((a, b) => b.total - a.total);
  const trendBuckets = (byKind.get('trend') || []).map((row) => agg.cacheMetrics.withCacheHitMetrics({
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
  })).sort((a, b) => a.start - b.start);
  return {
    source: { id: args.source.id, label: args.source.label, dbPath: args.source.dbPath },
    summary: {
      source: { id: args.source.id, label: args.source.label, dbPath: args.source.dbPath },
      usage: {
        today: firstUsage('summary_today'),
        window: firstUsage('summary_window'),
        week: firstUsage('summary_week'),
        all: firstUsage('summary_all'),
      },
    },
    sourceStat: {
      key: args.source.id,
      source: args.source.id,
      label: args.source.label,
      requests: sourceStatUsage.messages,
      ...sourceStatUsage,
    },
    modelStats,
    trendBuckets,
    sessionSummary: sessionSummaryForSourceSql(args),
  };
}

function messageTokenRowsForSourceSql({ db, tables, queryAll, payload = {} }) {
  const { where, params } = assistantWhere(payload);
  const sql = `${assistantTokenCtes(tables, where, { materialized: true })}
    select
      id,
      session_id as sessionId,
      time_created as timeCreated,
      time_updated as timeUpdated,
      provider,
      model,
      total,
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      error,
      case when message_completed >= message_created and message_created > 0 then message_completed - message_created else null end as latencyMs
    from assistant_tokens
    order by time_created asc`;
  return queryAll(db, sql, params).map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    timeCreated: sqlNumber(row.timeCreated),
    timeUpdated: sqlNumber(row.timeUpdated),
    provider: row.provider || 'unknown',
    model: row.model || 'unknown',
    total: sqlNumber(row.total),
    input: sqlNumber(row.input),
    output: sqlNumber(row.output),
    reasoning: sqlNumber(row.reasoning),
    cacheRead: sqlNumber(row.cacheRead),
    cacheWrite: sqlNumber(row.cacheWrite),
    messages: 1,
    errors: sqlNumber(row.error),
    latencyMs: row.latencyMs == null ? null : Number(row.latencyMs),
  }));
}

module.exports = {
  summaryForSourceSql,
  trendForSourceSql,
  sourceStatForSourceSql,
  modelStatsForSourceSql,
  sessionSummaryForSourceSql,
  sessionRowsForSourceSql,
  aggregateBundleForSourceSql,
  messageTokenRowsForSourceSql,
};
