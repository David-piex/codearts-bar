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
} = require('./aggregation-sql-expressions');

function latencyValuesByKey(rows = [], keyOf) {
  const values = new Map();
  for (const row of rows || []) {
    if (row.latency == null || row.latency === '') continue;
    const value = Number(row.latency);
    if (!Number.isFinite(value)) continue;
    const key = keyOf(row);
    const list = values.get(key) || [];
    list.push(value);
    values.set(key, list);
  }
  return values;
}

function percentilesForValues(values = new Map()) {
  return new Map([...values.entries()].map(([key, list]) => [key, agg.percentile(list, 95)]));
}

function latencyRowsForSource({ db, tables, queryAll, where, params, keySql }) {
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}
    select ${keySql} as key,
      case when message_completed >= message_created and message_created > 0 then message_completed - message_created else null end as latency
    from assistant_tokens`;
  return queryAll(db, sql, params);
}

function latencyRowsForBundle({ db, tables, queryAll, where, params, bucketExpression }) {
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}
    select provider,
      model,
      time_created as timeCreated,
      ${bucketExpression} as bucket,
      case when message_completed >= message_created and message_created > 0 then message_completed - message_created else null end as latency
    from assistant_tokens`;
  return queryAll(db, sql, params);
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
      null as latencyP95
    from bucketed
    group by bucket
    order by bucket asc`;
  const latencyValues = latencyValuesByKey(latencyRowsForSource({ db, tables, queryAll, where, params, keySql: bucketExpression }), (row) => Number(row.key));
  const p95 = percentilesForValues(latencyValues);
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
    latencyP95: p95.get(sqlNumber(row.start)) ?? null,
    _latencyValues: latencyValues.get(sqlNumber(row.start)) || [],
    label: new Date(sqlNumber(row.start)).toLocaleString('zh-CN', { hour12: false }),
  }));
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
      max(latency) as latencyMax
    from model_rows
    group by provider, model
    order by total desc`;
  const latencyValues = latencyValuesByKey(latencyRowsForSource({ db, tables, queryAll, where, params, keySql: "provider || char(0) || model" }), (row) => String(row.key || ''));
  const p95 = percentilesForValues(latencyValues);
  return queryAll(db, sql, params).map((row) => {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const latency = {
      count: sqlNumber(row.latencyCount),
      min: row.latencyMin == null ? null : Number(row.latencyMin),
      avg: row.latencyAvg == null ? null : Number(row.latencyAvg),
      p50: null,
      p90: null,
      p95: p95.get(`${provider}\u0000${model}`) ?? null,
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
      _latencyValues: latencyValues.get(`${provider}\u0000${model}`) || [],
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
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })},
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
      null as latencyP95
    from token_rows
    where time_created >= ${trendStart} and time_created < ${trendEnd}
    group by ${bucketExpression}`;
  return queryAll(db, sql, params);
}

function aggregateBundleForSourceSql(args) {
  // The previous cold path ran the materialized token CTE once for the UNION
  // bundle and once again for every latency percentile. Querying normalized
  // token rows once keeps the exact SQL filtering/part-token semantics while
  // doing summaries, models, buckets, and percentiles in one JS pass.
  const { source, db, tables, queryAll, payload, sessionPayload = { ...payload, query: payload.sessionQuery || '' }, windows, trendRange } = args;
  const tokenRows = messageTokenRowsForSourceSql({ db, tables, queryAll, payload });
  const bucketMs = Math.max(60000, safeNumber(trendRange.bucketMs, 3600000));
  const bucketOffsetMs = safeNumber(trendRange.bucketOffsetMs, 0);
  const trendStart = safeNumber(trendRange.start);
  const trendEnd = safeNumber(trendRange.endExclusive ?? trendRange.end);
  const inTrend = (row) => (!trendStart || row.timeCreated >= trendStart) && (!trendEnd || row.timeCreated < trendEnd);
  const usageFor = (items) => {
    const usage = { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 };
    for (const row of items) {
      usage.total += Number(row.total || 0);
      usage.input += Number(row.input || 0);
      usage.output += Number(row.output || 0);
      usage.reasoning += Number(row.reasoning || 0);
      usage.cacheRead += Number(row.cacheRead || 0);
      usage.cacheWrite += Number(row.cacheWrite || 0);
      usage.messages += Number(row.messages || 1);
      usage.errors += Number(row.errors || 0);
    }
    return agg.cacheMetrics.withCacheHitMetrics(usage);
  };
  const dayRows = [];
  const windowRows = [];
  const weekRows = [];
  for (const row of tokenRows) {
    if (row.timeCreated >= Number(windows.dayStartMs || 0)) dayRows.push(row);
    if (row.timeCreated >= Number(windows.windowStartMs || 0)) windowRows.push(row);
    if (row.timeCreated >= Number(windows.weekStartMs || 0)) weekRows.push(row);
  }
  const allUsage = usageFor(tokenRows);
  const sourceStatUsage = allUsage;
  const modelMap = new Map();
  for (const row of tokenRows) {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const key = `${provider}\u0000${model}`;
    const item = modelMap.get(key) || { provider, model, rows: [], latencyValues: [] };
    item.rows.push(row);
    if (row.latencyMs != null && Number.isFinite(Number(row.latencyMs))) item.latencyValues.push(Number(row.latencyMs));
    modelMap.set(key, item);
  }
  const modelStats = [...modelMap.values()].map((modelRows) => {
    const provider = modelRows.provider || 'unknown';
    const model = modelRows.model || 'unknown';
    const usage = usageFor(modelRows.rows);
    const latencyValues = modelRows.latencyValues;
    const latency = agg.summarize(latencyValues);
    const firstContent = agg.summarize(modelRows.rows.map((row) => row.firstContentMs));
    const outputTokensPerSec = agg.summarize(modelRows.rows.map((row) => row.outputTokensPerSec));
    return {
      name: `${provider} / ${model}`,
      provider,
      model,
      ...usage,
      source: source.id,
      sourceLabel: source.label,
      _latencyValues: latencyValues,
      performance: {
        latency,
        ttft: agg.summarize([]),
        firstContentApprox: firstContent,
        outputTokensPerSec,
        totalTokensPerSec: agg.summarize([]),
      },
    };
  }).sort((a, b) => b.total - a.total);
  const trendMap = new Map();
  for (const row of tokenRows) {
    if (!inTrend(row)) continue;
    const start = Math.floor((row.timeCreated + bucketOffsetMs) / bucketMs) * bucketMs - bucketOffsetMs;
    const bucket = trendMap.get(start) || { start, end: start + bucketMs, rows: [], latencyValues: [] };
    bucket.rows.push(row);
    if (row.latencyMs != null && Number.isFinite(Number(row.latencyMs))) bucket.latencyValues.push(Number(row.latencyMs));
    trendMap.set(start, bucket);
  }
  const trendBuckets = [...trendMap.values()].sort((a, b) => a.start - b.start).map((bucket) => {
    const usage = usageFor(bucket.rows);
    const latencyValues = bucket.latencyValues;
    return {
      ...usage,
      start: bucket.start,
      end: bucket.end,
      latencyAvg: latencyValues.length ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length : null,
      latencyP95: latencyValues.length ? agg.percentile(latencyValues, 95) : null,
      _latencyValues: latencyValues,
      label: new Date(bucket.start).toLocaleString('zh-CN', { hour12: false }),
    };
  });
  return {
    source: { id: source.id, label: source.label, dbPath: source.dbPath },
    summary: {
      source: { id: source.id, label: source.label, dbPath: source.dbPath },
      usage: {
        today: usageFor(dayRows),
        window: usageFor(windowRows),
        week: usageFor(weekRows),
        all: allUsage,
      },
    },
    sourceStat: {
      key: source.id,
      source: source.id,
      label: source.label,
      requests: sourceStatUsage.messages,
      ...sourceStatUsage,
    },
    modelStats,
    trendBuckets,
    performanceRows: tokenRows,
    sessionSummary: sessionSummaryForSourceSql({ ...args, payload: sessionPayload }),
  };
}

function messageTokenRowsForSourceSql({ db, tables, queryAll, payload = {} }) {
  const { where, params } = assistantWhere(payload);
  const sql = `${assistantTokenCtes(tables, where, { materialized: true, excludePlaceholders: true })}
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
  const rows = queryAll(db, sql, params);
  const partTimes = new Map();
  if (tables.includes('part') && rows.length) {
    const ids = rows.map((row) => row.id);
    const chunkSize = 400;
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const parts = queryAll(db, `select message_id, time_created, data from part where message_id in (${placeholders}) order by time_created asc, id asc`, chunk);
      for (const part of parts) {
        const type = (() => { try { return JSON.parse(part.data || '{}').type || ''; } catch { return ''; } })();
        if (type === 'step-start' || type === 'step-finish') continue;
        if (!partTimes.has(part.message_id)) partTimes.set(part.message_id, Number(part.time_created || 0));
      }
    }
  }
  return rows.map((row) => ({
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
    firstContentMs: partTimes.has(row.id) && Number(row.timeCreated || 0) > 0
      ? Math.max(0, partTimes.get(row.id) - Number(row.timeCreated || 0)) : null,
    outputTokensPerSec: row.latencyMs != null && Number(row.latencyMs) > 0
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
