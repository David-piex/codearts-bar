'use strict';

const agg = require('../../core/aggregator');
const {
  listDataSources,
  validateTables,
  sourceMatchesPayload,
  assistantWhere,
  sessionWhere,
  tagRows,
} = require('./sources');
const {
  openNativeDbReadonly,
  openSqlJsDbReadonly,
  nativeAll,
  nativeAllParams,
  sqlJsAll,
  sqlJsAllParams,
  closeDb,
} = require('./sqlite');
const { queryPartsForMessages } = require('./collect');

function addTokenInto(target, value = {}) {
  target.total += Number(value.total || 0);
  target.input += Number(value.input || 0);
  target.output += Number(value.output || 0);
  target.reasoning += Number(value.reasoning || 0);
  target.cacheRead += Number(value.cacheRead || 0);
  target.cacheWrite += Number(value.cacheWrite || 0);
  target.messages += Number(value.messages || value.requests || 0);
  target.errors += Number(value.errors || 0);
  return target;
}
function emptyUsage() { return { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 }; }
function addUsage(a, b) { return addTokenInto(a, b); }
function aggregateError(nativeError, page) { if (nativeError) page.nativeError = nativeError; return page; }
function queryAssistantRows(queryAll, db, source, payload = {}, start = 0, end = 0) {
  const range = { start: start || 0, end: end || 0 };
  const { where, params } = assistantWhere({ ...payload, range });
  return tagRows(queryAll(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created asc`, params), source);
}
function tokenUsageForRows(queryAll, db, source, tables, messages) {
  const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
  const partMap = agg.buildPartMap(parts);
  return { usage: agg.sumTokens(messages, partMap), partMap, parts };
}
function sourceList(payload = {}) {
  return listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload));
}
function timeWindows(payload = {}) {
  const timestamp = Number(payload.timestamp || Date.now());
  const dayStart = new Date(timestamp);
  dayStart.setHours(0, 0, 0, 0);
  const windowHours = Math.max(1, Math.min(24 * 365, Number(payload.windowHours || 24)));
  return {
    timestamp,
    dayStartMs: dayStart.getTime(),
    windowStartMs: timestamp - windowHours * 60 * 60 * 1000,
    weekStartMs: timestamp - 7 * 24 * 60 * 60 * 1000,
  };
}
function normalizeTrendRange(payload = {}) {
  const timestamp = Number(payload.timestamp || Date.now());
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const bucketMs = Math.max(60 * 1000, Number(payload.bucketMs || (payload.bucket === 'day' ? day : hour)) || hour);
  const startValue = payload.start ?? payload.range?.start ?? (payload.bucket === 'day' ? timestamp - 14 * day : timestamp - 24 * hour);
  const endValue = payload.end ?? payload.range?.end ?? timestamp;
  const start = Number(startValue);
  const end = Number(endValue);
  return { timestamp, start, end, bucketMs };
}
function runNativeAggregate(payload, worker) {
  const items = [];
  const errors = [];
  for (const source of sourceList(payload)) {
    let db;
    try {
      db = openNativeDbReadonly(source.dbPath);
      const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      items.push(worker({ source, db, tables, queryAll: nativeAllParams }));
    } catch (error) {
      errors.push({ source: source.id, message: error.message });
    } finally { closeDb(db); }
  }
  if (!items.length && errors.length) throw new Error(errors.map((e) => `${e.source}: ${e.message}`).join('; '));
  return { items, errors };
}
async function runSqlJsAggregate(payload, worker) {
  const items = [];
  const errors = [];
  for (const source of sourceList(payload)) {
    let db;
    try {
      db = await openSqlJsDbReadonly(source.dbPath);
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      items.push(worker({ source, db, tables, queryAll: sqlJsAllParams }));
    } catch (error) {
      errors.push({ source: source.id, message: error.message });
    } finally { closeDb(db); }
  }
  if (!items.length && errors.length) throw new Error(errors.map((e) => `${e.source}: ${e.message}`).join('; '));
  return { items, errors };
}
function mergeSummaryParts(parts, payload = {}) {
  const usage = { today: emptyUsage(), window: emptyUsage(), week: emptyUsage(), all: emptyUsage() };
  const sources = [];
  for (const part of parts) {
    if (!part) continue;
    addUsage(usage.today, part.usage.today);
    addUsage(usage.window, part.usage.window);
    addUsage(usage.week, part.usage.week);
    addUsage(usage.all, part.usage.all);
    sources.push(part.source);
  }
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), usage, sources };
}
function summaryWorker(payload = {}) {
  const windows = timeWindows(payload);
  return ({ source, db, tables, queryAll }) => {
    const allRows = queryAssistantRows(queryAll, db, source, payload, 0, 0);
    const { partMap } = tokenUsageForRows(queryAll, db, source, tables, allRows);
    const sumSince = (since) => agg.sumTokens(allRows.filter((m) => Number(m.time_created || 0) >= since), partMap);
    const usage = {
      today: sumSince(windows.dayStartMs),
      window: sumSince(windows.windowStartMs),
      week: sumSince(windows.weekStartMs),
      all: agg.sumTokens(allRows, partMap),
    };
    return { source: { id: source.id, label: source.label, dbPath: source.dbPath }, usage };
  };
}
function getSummaryNative(payload = {}) {
  const result = runNativeAggregate(payload, summaryWorker(payload));
  const merged = mergeSummaryParts(result.items, payload);
  if (result.errors.length) merged.sourceErrors = result.errors;
  return merged;
}
async function getSummarySqlJs(payload = {}) {
  const result = await runSqlJsAggregate(payload, summaryWorker(payload));
  const merged = mergeSummaryParts(result.items, payload);
  if (result.errors.length) merged.sourceErrors = result.errors;
  return merged;
}
async function getSummary(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSummaryNative(payload); }
    catch (error) { return aggregateError(error.message, await getSummarySqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getSummarySqlJs(payload));
}
function getTrendBucketsNative(payload = {}) {
  const { start, end, bucketMs, timestamp } = normalizeTrendRange(payload);
  const buckets = [];
  const result = runNativeAggregate(payload, ({ source, db, tables, queryAll }) => {
    const rows = queryAssistantRows(queryAll, db, source, payload, start, end);
    const { partMap } = tokenUsageForRows(queryAll, db, source, tables, rows);
    return agg.trendStats(rows, partMap, start, bucketMs);
  });
  for (const arr of result.items) for (const b of arr) buckets.push(b);
  const merged = mergeBuckets(buckets, bucketMs);
  return { ok: true, timestamp, start, end, bucketMs, buckets: merged, sourceErrors: result.errors };
}
async function getTrendBucketsSqlJs(payload = {}) {
  const { start, end, bucketMs, timestamp } = normalizeTrendRange(payload);
  const buckets = [];
  const result = await runSqlJsAggregate(payload, ({ source, db, tables, queryAll }) => {
    const rows = queryAssistantRows(queryAll, db, source, payload, start, end);
    const { partMap } = tokenUsageForRows(queryAll, db, source, tables, rows);
    return agg.trendStats(rows, partMap, start, bucketMs);
  });
  for (const arr of result.items) for (const b of arr) buckets.push(b);
  return { ok: true, timestamp, start, end, bucketMs, buckets: mergeBuckets(buckets, bucketMs), sourceErrors: result.errors };
}
async function getTrendBuckets(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getTrendBucketsNative(payload); }
    catch (error) { return aggregateError(error.message, await getTrendBucketsSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getTrendBucketsSqlJs(payload));
}
function mergeBuckets(items, bucketMs) {
  const map = new Map();
  for (const item of items || []) {
    const key = Number(item.start || 0);
    const prev = map.get(key) || { start: key, end: key + bucketMs, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, latencyAvg: null, latencyP95: null, _latencyWeighted: 0, _latencySamples: 0 };
    addUsage(prev, item);
    if (Number.isFinite(item.latencyAvg) && Number(item.messages || 0) > 0) {
      prev._latencyWeighted += item.latencyAvg * Number(item.messages || 0);
      prev._latencySamples += Number(item.messages || 0);
    }
    prev.latencyP95 = Math.max(prev.latencyP95 || 0, item.latencyP95 || 0) || null;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => a.start - b.start).map((b) => {
    b.latencyAvg = b._latencySamples ? b._latencyWeighted / b._latencySamples : null;
    delete b._latencyWeighted; delete b._latencySamples;
    b.label = new Date(b.start).toLocaleString('zh-CN', { hour12: false });
    return b;
  });
}
function getSourceStatsNative(payload = {}) {
  const range = payload.range || {};
  const result = runNativeAggregate(payload, ({ source, db, tables, queryAll }) => {
    const rows = queryAssistantRows(queryAll, db, source, payload, range.start || 0, range.end || 0);
    const { usage } = tokenUsageForRows(queryAll, db, source, tables, rows);
    return { key: source.id, source: source.id, label: source.label, requests: usage.messages, ...usage };
  });
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items.sort((a, b) => b.total - a.total), sourceErrors: result.errors };
}
async function getSourceStatsSqlJs(payload = {}) {
  const range = payload.range || {};
  const result = await runSqlJsAggregate(payload, ({ source, db, tables, queryAll }) => {
    const rows = queryAssistantRows(queryAll, db, source, payload, range.start || 0, range.end || 0);
    const { usage } = tokenUsageForRows(queryAll, db, source, tables, rows);
    return { key: source.id, source: source.id, label: source.label, requests: usage.messages, ...usage };
  });
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items.sort((a, b) => b.total - a.total), sourceErrors: result.errors };
}
async function getSourceStats(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSourceStatsNative(payload); }
    catch (error) { return aggregateError(error.message, await getSourceStatsSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getSourceStatsSqlJs(payload));
}
function modelStatsWorker(payload = {}) {
  const range = payload.range || {};
  return ({ source, db, tables, queryAll }) => {
    const rows = queryAssistantRows(queryAll, db, source, payload, range.start || 0, range.end || 0);
    const { partMap } = tokenUsageForRows(queryAll, db, source, tables, rows);
    return agg.modelStats(rows, 0, partMap).map((x) => ({ ...x, source: source.id, sourceLabel: source.label }));
  };
}
function mergeModelStats(items) {
  const map = new Map();
  for (const arr of items || []) for (const item of arr || []) {
    const key = item.name || `${item.provider} / ${item.model}`;
    const prev = map.get(key) || { name: key, provider: item.provider, model: item.model, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, sources: [] };
    addUsage(prev, item);
    prev.sources.push(item.source);
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
function getModelStatsNative(payload = {}) {
  const result = runNativeAggregate(payload, modelStatsWorker(payload));
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: mergeModelStats(result.items), sourceErrors: result.errors };
}
async function getModelStatsSqlJs(payload = {}) {
  const result = await runSqlJsAggregate(payload, modelStatsWorker(payload));
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: mergeModelStats(result.items), sourceErrors: result.errors };
}
async function getModelStats(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getModelStatsNative(payload); }
    catch (error) { return aggregateError(error.message, await getModelStatsSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getModelStatsSqlJs(payload));
}
function getSessionSummaryNative(payload = {}) {
  const result = runNativeAggregate(payload, ({ source, db, queryAll }) => sessionSummaryForSource(queryAll, db, source, payload));
  return mergeSessionSummaries(result.items, payload, result.errors);
}
async function getSessionSummarySqlJs(payload = {}) {
  const result = await runSqlJsAggregate(payload, ({ source, db, queryAll }) => sessionSummaryForSource(queryAll, db, source, payload));
  return mergeSessionSummaries(result.items, payload, result.errors);
}
async function getSessionSummary(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSessionSummaryNative(payload); }
    catch (error) { return aggregateError(error.message, await getSessionSummarySqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getSessionSummarySqlJs(payload));
}
function sessionSummaryForSource(queryAll, db, source, payload = {}) {
  const basePayload = { ...payload, status: 'all' };
  const { where, params } = sessionWhere(basePayload);
  const rows = queryAll(db, `select id, title, directory, time_created, time_updated, time_archived from session where ${where}`, params);
  const projects = new Map();
  let active = 0;
  let archived = 0;
  let recent7d = 0;
  const weekAgo = Number(payload.timestamp || Date.now()) - 7 * 86400000;
  for (const row of rows) {
    if (row.time_archived) archived += 1; else active += 1;
    if (Number(row.time_updated || 0) >= weekAgo) recent7d += 1;
    const dir = row.directory || '';
    const key = dir || '__none';
    const prev = projects.get(key) || { key, directory: dir, count: 0, active: 0, archived: 0, updatedAt: 0 };
    prev.count += 1;
    if (row.time_archived) prev.archived += 1; else prev.active += 1;
    prev.updatedAt = Math.max(prev.updatedAt, Number(row.time_updated || 0));
    projects.set(key, prev);
  }
  return { source: source.id, sourceLabel: source.label, total: rows.length, active, archived, recent7d, projects: [...projects.values()].sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt).slice(0, 20) };
}
function mergeSessionSummaries(items, payload = {}, errors = []) {
  const out = { ok: true, timestamp: Number(payload.timestamp || Date.now()), total: 0, active: 0, archived: 0, recent7d: 0, bySource: [], projects: [], sourceErrors: errors };
  const projectMap = new Map();
  for (const item of items || []) {
    out.total += item.total || 0;
    out.active += item.active || 0;
    out.archived += item.archived || 0;
    out.recent7d += item.recent7d || 0;
    out.bySource.push({ source: item.source, label: item.sourceLabel, total: item.total, active: item.active, archived: item.archived, recent7d: item.recent7d });
    for (const p of item.projects || []) {
      const prev = projectMap.get(p.key) || { ...p, count: 0, active: 0, archived: 0, updatedAt: 0 };
      prev.count += p.count || 0;
      prev.active += p.active || 0;
      prev.archived += p.archived || 0;
      prev.updatedAt = Math.max(prev.updatedAt || 0, p.updatedAt || 0);
      projectMap.set(p.key, prev);
    }
  }
  out.projects = [...projectMap.values()].sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt).slice(0, 20);
  return out;
}
function getDatabaseHealthNative(payload = {}) {
  const result = runNativeAggregate(payload, ({ source, db, tables, queryAll }) => {
    const quick = queryAll(db, 'pragma quick_check(1)', []);
    const messageCount = queryAll(db, 'select count(*) as count from message', [])[0]?.count || 0;
    const sessionCount = queryAll(db, 'select count(*) as count from session', [])[0]?.count || 0;
    return { source: source.id, label: source.label, dbPath: source.dbPath, ok: true, quickCheck: Object.values(quick[0] || {})[0] || 'ok', tables, messageCount, sessionCount };
  });
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items, sourceErrors: result.errors };
}
async function getDatabaseHealthSqlJs(payload = {}) {
  const result = await runSqlJsAggregate(payload, ({ source, db, tables, queryAll }) => {
    const quick = queryAll(db, 'pragma quick_check(1)', []);
    const messageCount = queryAll(db, 'select count(*) as count from message', [])[0]?.count || 0;
    const sessionCount = queryAll(db, 'select count(*) as count from session', [])[0]?.count || 0;
    return { source: source.id, label: source.label, dbPath: source.dbPath, ok: true, quickCheck: Object.values(quick[0] || {})[0] || 'ok', tables, messageCount, sessionCount };
  });
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items, sourceErrors: result.errors };
}
async function getDatabaseHealth(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getDatabaseHealthNative(payload); }
    catch (error) { return aggregateError(error.message, await getDatabaseHealthSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getDatabaseHealthSqlJs(payload));
}

module.exports = {
  getSummary,
  getSummaryNative,
  getSummarySqlJs,
  getTrendBuckets,
  getTrendBucketsNative,
  getTrendBucketsSqlJs,
  getSourceStats,
  getSourceStatsNative,
  getSourceStatsSqlJs,
  getModelStats,
  getModelStatsNative,
  getModelStatsSqlJs,
  getSessionSummary,
  getSessionSummaryNative,
  getSessionSummarySqlJs,
  getDatabaseHealth,
  getDatabaseHealthNative,
  getDatabaseHealthSqlJs,
};
