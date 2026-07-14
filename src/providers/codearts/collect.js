'use strict';

const agg = require('../../core/aggregator');
const { listDataSources, ensureReadableDb, validateTables, tagRows, placeholders, jsonExtractExpr, messageModelExpr } = require('./sources');
const { openNativeDbReadonly, openSqlJsDbReadonly, nativeAll, sqlJsAll, nativeAllParams, sqlJsAllParams, closeDb } = require('./sqlite');

function chunked(list, size = 800) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function collectOneNative(source) {
  const stat = ensureReadableDb(source.dbPath);
  const db = openNativeDbReadonly(source.dbPath);
  try {
    const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
    validateTables(tables);
    return {
      adapter: 'node:sqlite', source, dbPath: source.dbPath, stat, tables,
      messages: tagRows(nativeAll(db, 'select id, session_id, time_created, time_updated, data from message order by time_created desc'), source),
      sessions: tagRows(nativeAll(db, 'select id, title, directory, version, time_created, time_updated, time_archived from session order by time_updated desc'), source),
      parts: tables.includes('part') ? tagRows(nativeAll(db, 'select id, message_id, session_id, time_created, time_updated, data from part order by time_created asc'), source) : [],
    };
  } finally { closeDb(db); }
}
async function collectOneSqlJs(source) {
  const stat = ensureReadableDb(source.dbPath);
  const db = await openSqlJsDbReadonly(source.dbPath);
  try {
    const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
    validateTables(tables);
    return {
      adapter: 'sql.js', source, dbPath: source.dbPath, stat, tables,
      messages: tagRows(sqlJsAll(db, 'select id, session_id, time_created, time_updated, data from message order by time_created desc'), source),
      sessions: tagRows(sqlJsAll(db, 'select id, title, directory, version, time_created, time_updated, time_archived from session order by time_updated desc'), source),
      parts: tables.includes('part') ? tagRows(sqlJsAll(db, 'select id, message_id, session_id, time_created, time_updated, data from part order by time_created asc'), source) : [],
    };
  } finally { closeDb(db); }
}
function mergeCollections(collections, adapter = 'mixed', errors = []) {
  const existing = collections.filter(Boolean);
  if (!existing.length) {
    if (errors.length === 1) throw new Error(errors[0].error);
    throw new Error('没有可读取的 CodeArts 数据源');
  }
  const primary = existing[0];
  return {
    adapter,
    dbPath: primary.dbPath,
    stat: primary.stat,
    tables: primary.tables,
    sources: existing.map((x) => ({ id: x.source.id, label: x.source.label, dbPath: x.dbPath, size: x.stat.size, mtimeMs: x.stat.mtimeMs, adapter: x.adapter })),
    messages: existing.flatMap((x) => x.messages),
    sessions: existing.flatMap((x) => x.sessions).sort((a, b) => b.time_updated - a.time_updated),
    parts: existing.flatMap((x) => x.parts).sort((a, b) => a.time_created - b.time_created),
  };
}
function requestRowsFromMessages(messages, sessions, parts) {
  const partMap = agg.buildPartMap(parts);
  const sessionMap = new Map((sessions || []).map((s) => [`${s.source || ''}:${s.id || ''}`, s]));
  return (messages || [])
    .map((row) => {
      const data = agg.parseJsonSafe(row.data, {});
      if (data.role !== 'assistant') return null;
      const token = agg.tokenForMessage(row, partMap);
      const perf = agg.messagePerf(row, partMap, new Map()) || {};
      const session = sessionMap.get(`${row.source || ''}:${row.session_id || ''}`) || {};
      const error = agg.extractError(data);
      return {
        id: row.id,
        sessionId: row.session_id,
        sessionTitle: session.title || '(无标题)',
        source: row.source || 'unknown',
        sourceLabel: row.sourceLabel || row.source || 'unknown',
        provider: data.providerID || data.model?.providerID || perf.provider || 'unknown',
        model: data.modelID || data.model?.modelID || perf.model || 'unknown',
        createdAt: row.time_created,
        updatedAt: row.time_updated,
        time: row.time_created,
        status: error?.statusCode || (data.error ? 'error' : 200),
        ok: !data.error,
        error: error ? error.message : null,
        latencyMs: perf.latencyMs,
        ttftMs: perf.ttftMs,
        firstContentMs: perf.firstContentMs,
        outputTokensPerSec: perf.outputTokensPerSec,
        ...token,
      };
    })
    .filter(Boolean);
}
function sessionsFromRows(sessions, messages, parts, timestamp = Date.now()) {
  const partMap = agg.buildPartMap(parts);
  const usageMap = agg.buildSessionUsageMap(messages, partMap, 0);
  return (sessions || []).map((s) => {
    const usage = usageMap.get(`${s.source || ''}:${s.id || ''}`) || { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, userTurns: 0, modelCalls: 0, errors: 0, models: [], topModel: null };
    return {
      id: s.id,
      title: s.title || '(无标题)',
      directory: s.directory,
      version: s.version,
      createdAt: s.time_created,
      updatedAt: s.time_updated,
      archivedAt: s.time_archived || null,
      age: timestamp - s.time_updated,
      archived: Boolean(s.time_archived),
      source: s.source,
      sourceLabel: s.sourceLabel,
      dbPath: s.dbPath,
      usage,
    };
  });
}

function queryPartsForMessages(queryAll, db, source, messageIds) {
  const ids = [...new Set((messageIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = [];
  for (const batch of chunked(ids)) {
    const sql = `select id, message_id, session_id, time_created, time_updated, data from part where message_id in (${placeholders(batch)}) order by time_created asc`;
    rows.push(...tagRows(queryAll(db, sql, batch), source));
  }
  return rows.sort((a, b) => (a.time_created || 0) - (b.time_created || 0));
}
function querySessionsByIds(queryAll, db, source, sessionIds) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return [];
  const sql = `select id, title, directory, version, time_created, time_updated, time_archived from session where id in (${placeholders(ids)})`;
  return tagRows(queryAll(db, sql, ids), source);
}
function queryMessagesForSessions(queryAll, db, source, sessionIds, payload = {}) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return [];
  const where = [`session_id in (${placeholders(ids)})`];
  const params = [...ids];
  if (payload.model && payload.model !== 'all') {
    where.push(`${jsonExtractExpr('data', '$.role')} = 'assistant'`);
    where.push(`${messageModelExpr('data')} = ?`);
    params.push(String(payload.model));
  }
  const sql = `select id, session_id, time_created, time_updated, data from message where ${where.join(' and ')} order by time_created desc`;
  return tagRows(queryAll(db, sql, params), source);
}
function collectRowsNative(options = {}) {
  const sources = listDataSources(options);
  const out = [];
  const errors = [];
  for (const source of sources) {
    try { out.push(collectOneNative(source)); }
    catch (error) { errors.push({ source, error: error.message }); }
  }
  const merged = mergeCollections(out, 'node:sqlite', errors);
  if (errors.length) merged.sourceErrors = errors;
  return merged;
}
async function collectRowsSqlJs(options = {}) {
  const sources = listDataSources(options);
  const out = [];
  const errors = [];
  for (const source of sources) {
    try { out.push(await collectOneSqlJs(source)); }
    catch (error) { errors.push({ source, error: error.message }); }
  }
  const merged = mergeCollections(out, 'sql.js', errors);
  if (errors.length) merged.sourceErrors = errors;
  return merged;
}
async function collectRows(options = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return collectRowsNative(options); }
    catch (error) {
      const rows = await collectRowsSqlJs(options);
      rows.nativeError = error.message;
      return rows;
    }
  }
  const rows = await collectRowsSqlJs(options);
  rows.nativeError = 'CODEARTS_BAR_FORCE_SQLJS=1';
  return rows;
}

module.exports = { chunked, collectOneNative, collectOneSqlJs, mergeCollections, collectRowsNative, collectRowsSqlJs, collectRows, requestRowsFromMessages, sessionsFromRows, queryPartsForMessages, querySessionsByIds, queryMessagesForSessions };
