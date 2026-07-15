'use strict';

const agg = require('../../core/aggregator');
const {
  validateTables,
  assistantWhere,
  sessionWhere,
  tagRows,
  resolveTimestamp,
} = require('./sources');
const { safeDbError } = require('./diagnostics');
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
const { sourceList, timeWindows } = require('./aggregation-runtime');

function queryAssistantRows(queryAll, db, source, payload = {}, start, end, tables = []) {
  const payloadRange = payload.range || {};
  const range = {
    start: start ?? payloadRange.start ?? 0,
    endExclusive: end ?? payloadRange.endExclusive ?? payloadRange.end ?? 0,
  };
  const { where, params } = assistantWhere({ ...payload, range }, { hasPart: tables.includes('part'), excludePlaceholders: true, outerAlias: 'message' });
  return tagRows(queryAll(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created asc`, params), source);
}
function tokenUsageForRows(queryAll, db, source, tables, messages) {
  const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
  const partMap = agg.buildPartMap(parts);
  return { usage: agg.sumTokens(messages, partMap), partMap, parts };
}
function runNativeAggregate(payload, worker, sources = null) {
  const items = [];
  const errors = [];
  for (const source of sources || sourceList(payload)) {
    let db;
    try {
      db = openNativeDbReadonly(source.dbPath);
      const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      items.push(worker({ source, db, tables, queryAll: nativeAllParams }));
    } catch (error) {
      errors.push({ source: source.id, message: safeDbError(error) });
    } finally { closeDb(db); }
  }
  if (!items.length && errors.length) throw new Error(errors.map((e) => `${e.source}: ${e.message}`).join('; '));
  return { items, errors };
}
async function runSqlJsAggregate(payload, worker, sources = null) {
  const items = [];
  const errors = [];
  for (const source of sources || sourceList(payload)) {
    let db;
    try {
      db = await openSqlJsDbReadonly(source.dbPath);
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      items.push(worker({ source, db, tables, queryAll: sqlJsAllParams }));
    } catch (error) {
      errors.push({ source: source.id, message: safeDbError(error) });
    } finally { closeDb(db); }
  }
  if (!items.length && errors.length) throw new Error(errors.map((e) => `${e.source}: ${e.message}`).join('; '));
  return { items, errors };
}
function summaryWorker(payload = {}) {
  const windows = timeWindows(payload);
  return ({ source, db, tables, queryAll }) => {
    const range = payload.range || {};
    const allRows = queryAssistantRows(queryAll, db, source, payload, range.start || 0, range.endExclusive ?? range.end ?? 0, tables);
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
function modelStatsWorker(payload = {}) {
  const range = payload.range || {};
  return ({ source, db, tables, queryAll }) => {
    const rows = queryAssistantRows(queryAll, db, source, payload, range.start || 0, range.endExclusive ?? range.end ?? 0, tables);
    const { partMap } = tokenUsageForRows(queryAll, db, source, tables, rows);
    return agg.modelStats(rows, 0, partMap).map((x) => ({ ...x, source: source.id, sourceLabel: source.label }));
  };
}
function sessionSummaryForSource(queryAll, db, source, payload = {}) {
  const basePayload = { ...payload, status: 'all' };
  const { where, params } = sessionWhere(basePayload);
  const rows = queryAll(db, `select id, title, directory, time_created, time_updated, time_archived from session where ${where}`, params);
  const projects = new Map();
  let active = 0;
  let archived = 0;
  let recent7d = 0;
  const weekAgo = resolveTimestamp(payload) - 7 * 86400000;
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

module.exports = {
  queryAssistantRows,
  tokenUsageForRows,
  runNativeAggregate,
  runSqlJsAggregate,
  summaryWorker,
  modelStatsWorker,
  sessionSummaryForSource,
};
