'use strict';

const agg = require('../../core/aggregator');
const { assistantWhere, sessionWhere, resolveTimestamp, jsonExtractExpr } = require('./sources');

const {
  safeNumber,
  sqlNumber,
  assistantTokenCtes,
  usageColumns,
  usageSelect,
  usageFromRow,
  usageFromAggregateRow,
  rowUsage,
} = require('./aggregation-sql-expressions');

function latencyValues(value) {
  if (value == null || value === '') return [];
  return String(value).split(',').map(Number).filter(Number.isFinite);
}

function summaryForSourceSql({ source, db, tables, queryAll, payload, windows }) {
  const { where, params } = assistantWhere(payload);
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}
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
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })},
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
      group_concat(latency) as latencyValues
    from bucketed
    group by bucket
    order by bucket asc`;
  return queryAll(db, sql, params).map((row) => {
    const values = latencyValues(row.latencyValues);
    const start = sqlNumber(row.start);
    return agg.cacheMetrics.withCacheHitMetrics({
      start,
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
      latencyP95: agg.percentile(values, 95),
      _latencyValues: values,
      label: new Date(start).toLocaleString('zh-CN', { hour12: false }),
    });
  });
}

function sourceStatForSourceSql({ source, db, tables, queryAll, payload }) {
  const range = payload.range || {};
  const { where, params } = assistantWhere({ ...payload, range });
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}
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
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })},
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
      max(latency) as latencyMax,
      group_concat(latency) as latencyValues
    from model_rows
    group by provider, model
    order by total desc`;
  return queryAll(db, sql, params).map((row) => {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const values = latencyValues(row.latencyValues);
    const latency = {
      count: sqlNumber(row.latencyCount),
      min: row.latencyMin == null ? null : Number(row.latencyMin),
      avg: row.latencyAvg == null ? null : Number(row.latencyAvg),
      p50: null,
      p90: null,
      p95: agg.percentile(values, 95),
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
      _latencyValues: values,
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

function sessionSummaryForSourceSql({ source, db, queryAll, payload, sessionColumns }) {
  const basePayload = { ...payload, status: 'all' };
  const { where, params } = sessionWhere(basePayload, { sessionColumns });
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

function sessionRowsForSourceSql({ db, queryAll, sessionColumns }) {
  const { where, params } = sessionWhere({ status: 'all' }, { sessionColumns });
  return queryAll(db, `select
      id,
      title,
      directory,
      time_created as timeCreated,
      time_updated as timeUpdated,
      time_archived as timeArchived
    from session
    where ${where}`, params).map((row) => ({
    id: row.id,
    title: row.title || '',
    directory: row.directory || '',
    timeCreated: sqlNumber(row.timeCreated),
    timeUpdated: sqlNumber(row.timeUpdated),
    timeArchived: row.timeArchived == null ? null : sqlNumber(row.timeArchived),
  }));
}

function aggregateBundleRowsForSourceSql({ db, tables, queryAll, payload, windows, trendRange }) {
  const includeExtendedPerformance = payload.includeExtendedPerformance !== false;
  const bucketMs = Math.max(60000, safeNumber(trendRange.bucketMs, 3600000));
  const bucketOffsetMs = safeNumber(trendRange.bucketOffsetMs, 0);
  const bucketExpression = `cast((time_created + ${bucketOffsetMs}) / ${bucketMs} as integer) * ${bucketMs} - ${bucketOffsetMs}`;
  const trendStart = safeNumber(trendRange.start);
  const trendEnd = safeNumber(trendRange.endExclusive ?? trendRange.end);
  const { where, params } = assistantWhere(payload);
  const metricColumns = `null as key, null as label, null as provider, null as model, null as start, null as end`;
  const nullLatency = 'null as latencyCount, null as latencyMin, null as latencyAvg, null as latencyMax, null as latencyValues, null as firstContentValues, null as outputTokensPerSecValues';
  const firstContentCte = includeExtendedPerformance && tables.includes('part') ? `,
    first_content as (
      select p.message_id, min(p.time_created) as firstCreated
      from part p join assistant_tokens at on at.id = p.message_id
      where coalesce(${jsonExtractExpr('p.data', '$.type')}, '') not in ('step-start', 'step-finish')
      group by p.message_id
    )` : '';
  const firstContentJoin = includeExtendedPerformance && tables.includes('part') ? 'left join first_content fc on fc.message_id = at.id' : '';
  const firstContentColumn = includeExtendedPerformance && tables.includes('part')
    ? 'case when fc.firstCreated is not null then max(0, fc.firstCreated - at.message_created) else null end'
    : 'null';
  const outputSpeedColumn = includeExtendedPerformance
    ? 'case when at.message_completed > at.message_created then at.output / ((at.message_completed - at.message_created) / 1000.0) else null end'
    : 'null';
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}${firstContentCte},
    token_rows as materialized (
      select at.*,
        case when at.message_completed >= at.message_created and at.message_created > 0 then at.message_completed - at.message_created else null end as latency,
        ${firstContentColumn} as firstContentMs,
        ${outputSpeedColumn} as outputTokensPerSec
      from assistant_tokens at ${firstContentJoin}
    )
    select 'summary_today' as kind, ${metricColumns}, ${usageColumns(`time_created >= ${safeNumber(windows.dayStartMs)}`)}, ${nullLatency} from token_rows
    union all
    select 'summary_window' as kind, ${metricColumns}, ${usageColumns(`time_created >= ${safeNumber(windows.windowStartMs)}`)}, ${nullLatency} from token_rows
    union all
    select 'summary_week' as kind, ${metricColumns}, ${usageColumns(`time_created >= ${safeNumber(windows.weekStartMs)}`)}, ${nullLatency} from token_rows
    union all
    select 'summary_all' as kind, ${metricColumns}, ${usageColumns('1=1')}, ${nullLatency} from token_rows
    union all
    select 'sourceStat' as kind, ${metricColumns}, ${usageColumns('1=1')}, ${nullLatency} from token_rows
    union all
    select 'model' as kind,
      provider || ' / ' || model as key, null as label, provider, model, null as start, null as end,
      sum(total) as total, sum(input) as input, sum(output) as output, sum(reasoning) as reasoning, sum(cacheRead) as cacheRead, sum(cacheWrite) as cacheWrite, count(*) as messages, sum(error) as errors,
      count(latency) as latencyCount, min(latency) as latencyMin, avg(latency) as latencyAvg, max(latency) as latencyMax, group_concat(latency) as latencyValues, group_concat(firstContentMs) as firstContentValues, group_concat(outputTokensPerSec) as outputTokensPerSecValues
    from token_rows group by provider, model
    union all
    select 'trend' as kind,
      ${bucketExpression} as key, null as label, null as provider, null as model,
      ${bucketExpression} as start, ${bucketExpression} + ${bucketMs} as end,
      sum(total) as total, sum(input) as input, sum(output) as output, sum(reasoning) as reasoning, sum(cacheRead) as cacheRead, sum(cacheWrite) as cacheWrite, count(*) as messages, sum(error) as errors,
      count(latency) as latencyCount, null as latencyMin, avg(latency) as latencyAvg, null as latencyMax, group_concat(latency) as latencyValues, group_concat(firstContentMs) as firstContentValues, group_concat(outputTokensPerSec) as outputTokensPerSecValues
    from token_rows
    where time_created >= ${trendStart} and time_created < ${trendEnd}
    group by ${bucketExpression}
    union all
    select 'performance' as kind, ${metricColumns}, ${usageColumns('1=1')},
      count(latency) as latencyCount, min(latency) as latencyMin, avg(latency) as latencyAvg, max(latency) as latencyMax, group_concat(latency) as latencyValues, group_concat(firstContentMs) as firstContentValues, group_concat(outputTokensPerSec) as outputTokensPerSecValues
    from token_rows`;
  return queryAll(db, sql, params);
}

function samplesFromRow(row, field) {
  return latencyValues(row?.[field]);
}

function performanceFromAggregateRow(row) {
  if (!row) return null;
  const latencySamples = samplesFromRow(row, 'latencyValues');
  const firstContentSamples = samplesFromRow(row, 'firstContentValues');
  const outputSpeedSamples = samplesFromRow(row, 'outputTokensPerSecValues');
  const performance = {
    samples: sqlNumber(row.messages),
    completed: sqlNumber(row.latencyCount),
    errors: sqlNumber(row.errors),
    errorRate: sqlNumber(row.messages) ? sqlNumber(row.errors) / sqlNumber(row.messages) : 0,
    latency: agg.summarize(latencySamples),
    ttft: agg.summarize([]),
    firstContentApprox: agg.summarize(firstContentSamples),
    outputTokensPerSec: agg.summarize(outputSpeedSamples),
    totalTokensPerSec: agg.summarize([]),
  };
  performance.complete = performance.completed === performance.samples;
  performance.metricCompleteness = {
    latency: performance.complete,
    firstContentApprox: performance.firstContentApprox.count === performance.samples,
    outputTokensPerSec: performance.outputTokensPerSec.count === performance.completed,
    ttft: false,
  };
  Object.defineProperty(performance, '_latencyValues', { value: latencySamples, enumerable: false, configurable: true });
  Object.defineProperty(performance, '_firstContentValues', { value: firstContentSamples, enumerable: false, configurable: true });
  Object.defineProperty(performance, '_outputTokensPerSecValues', { value: outputSpeedSamples, enumerable: false, configurable: true });
  return performance;
}

function aggregateBundleForSourceSql(args) {
  const { source, db, tables, queryAll, payload, sessionPayload = { ...payload, query: payload.sessionQuery || '' }, windows, trendRange } = args;
  const rows = aggregateBundleRowsForSourceSql(args);
  const byKind = new Map();
  for (const row of rows) byKind.set(row.kind === 'model' || row.kind === 'trend' ? `${row.kind}:${row.key}` : row.kind, row);
  const sourceInfo = { id: source.id, label: source.label, dbPath: source.dbPath };
  const summary = (kind) => usageFromAggregateRow(byKind.get(kind) || {});
  const modelStats = rows.filter((row) => row.kind === 'model').map((row) => {
    const latency = agg.summarize(samplesFromRow(row, 'latencyValues'));
    const item = {
      name: row.key, provider: row.provider || 'unknown', model: row.model || 'unknown', ...rowUsage(row),
      source: source.id, sourceLabel: source.label,
      performance: {
        latency: { ...latency, count: sqlNumber(row.latencyCount) },
        ttft: agg.summarize([]),
        firstContentApprox: agg.summarize(samplesFromRow(row, 'firstContentValues')),
        outputTokensPerSec: agg.summarize(samplesFromRow(row, 'outputTokensPerSecValues')),
        totalTokensPerSec: agg.summarize([]),
      },
    };
    Object.defineProperty(item, '_latencyValues', { value: samplesFromRow(row, 'latencyValues'), enumerable: false, configurable: true });
    return item;
  }).sort((a, b) => b.total - a.total);
  const trendBuckets = rows.filter((row) => row.kind === 'trend').map((row) => {
    const samples = samplesFromRow(row, 'latencyValues');
    const item = {
      ...rowUsage(row), start: sqlNumber(row.start), end: sqlNumber(row.end),
      latencyAvg: row.latencyAvg == null ? null : Number(row.latencyAvg),
      latencyP95: samples.length ? agg.percentile(samples, 95) : null,
      label: new Date(Number(row.start || 0)).toLocaleString('zh-CN', { hour12: false }),
    };
    Object.defineProperty(item, '_latencyValues', { value: samples, enumerable: false, configurable: true });
    return item;
  }).sort((a, b) => a.start - b.start);
  return {
    source: sourceInfo,
    summary: { source: sourceInfo, usage: { today: summary('summary_today'), window: summary('summary_window'), week: summary('summary_week'), all: summary('summary_all') } },
    sourceStat: { key: source.id, source: source.id, label: source.label, requests: summary('sourceStat').messages, ...summary('sourceStat') },
    modelStats,
    trendBuckets,
    performance: performanceFromAggregateRow(byKind.get('performance')),
    sessionSummary: sessionSummaryForSourceSql({ ...args, payload: sessionPayload }),
  };
}

function messageTokenRowsForSourceSql({ db, tables, queryAll, payload = {}, onProgress = null, estimatedRows = 0 }) {
  const includeExtendedPerformance = payload.includeExtendedPerformance !== false;
  const { where, params } = assistantWhere(payload);
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}
    select
      id,
      session_id as sessionId,
      time_created as timeCreated,
      time_updated as timeUpdated,
      coalesce((select directory from session rollup_session where rollup_session.id = assistant_tokens.session_id), '') as directory,
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
  const rows = queryAll(db, sql, params);
  if (typeof onProgress === 'function') onProgress({
    phase: tables.includes('part') && rows.length ? 'enriching' : 'normalizing',
    percent: tables.includes('part') && rows.length ? 58 : 72,
    scannedRows: rows.length,
    totalRows: Math.max(rows.length, Number(estimatedRows || 0)),
  });
  const partTimes = new Map();
  if (includeExtendedPerformance && tables.includes('part') && rows.length) {
    // Resolve first-content timestamps in one indexed join. The old chunked
    // IN queries multiplied SQL.js round trips by the message count.
    const filtered = assistantWhere(payload, { outerAlias: 'm' });
    const parts = queryAll(db, `with filtered_messages as (
      select m.id
      from message m
      where ${filtered.where}
    )
    select p.message_id as messageId, min(p.time_created) as timeCreated
    from part p
    join filtered_messages fm on fm.id = p.message_id
    where coalesce(${jsonExtractExpr('p.data', '$.type')}, '') not in ('step-start', 'step-finish')
    group by p.message_id`, filtered.params);
    for (const part of parts) partTimes.set(String(part.messageId || ''), Number(part.timeCreated || 0));
    if (typeof onProgress === 'function') onProgress({
      phase: 'enriching', percent: 72,
      scannedRows: rows.length, totalRows: Math.max(rows.length, Number(estimatedRows || 0)),
    });
  }
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    timeCreated: sqlNumber(row.timeCreated),
    timeUpdated: sqlNumber(row.timeUpdated),
    directory: row.directory || '',
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
    firstContentMs: includeExtendedPerformance && partTimes.has(row.id) && Number(row.timeCreated || 0) > 0
      ? Math.max(0, partTimes.get(row.id) - Number(row.timeCreated || 0)) : null,
    outputTokensPerSec: includeExtendedPerformance && row.latencyMs != null && Number(row.latencyMs) > 0
      ? sqlNumber(row.output) / (Number(row.latencyMs) / 1000) : null,
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
