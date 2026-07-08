'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSettings } = require('../settings');
const agg = require('../core/aggregator');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'opencode.db');
const CLI_DB_PATH = path.join(os.homedir(), '.codeartsdoer', 'cli-data', 'opencode.db');
const SOURCE_DEFS = [
  { id: 'desktop', label: '桌面端', dbPath: DEFAULT_DB_PATH, logRoot: path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'log') },
  { id: 'cli', label: 'CLI', dbPath: CLI_DB_PATH, logRoot: path.join(os.homedir(), '.codeartsdoer', 'cli-data', 'log') },
];

function resolveDbPath(options = {}) { return options.dbPath || loadSettings().dbPath || process.env.CODEARTS_BAR_DB || DEFAULT_DB_PATH; }
function sourceForDb(dbPath) { return SOURCE_DEFS.find((s) => path.resolve(s.dbPath).toLowerCase() === path.resolve(dbPath).toLowerCase()) || { id: 'custom', label: '自定义', dbPath, logRoot: path.join(path.dirname(dbPath), 'log') }; }
function listDataSources(options = {}) {
  const savedDbPath = loadSettings().dbPath;
  const candidates = [options.dbPath, process.env.CODEARTS_BAR_DB, savedDbPath].filter(Boolean);
  const explicitDbPath = candidates.find((candidate) => path.resolve(candidate).toLowerCase() !== path.resolve(DEFAULT_DB_PATH).toLowerCase());
  if (explicitDbPath) {
    const dbPath = explicitDbPath;
    return [{ ...sourceForDb(dbPath), dbPath }];
  }
  return SOURCE_DEFS.filter((s) => fs.existsSync(s.dbPath));
}
function ensureReadableDb(dbPath) {
  if (!fs.existsSync(dbPath)) throw new Error(`CodeArts 数据库不存在：${dbPath}`);
  const stat = fs.statSync(dbPath);
  if (!stat.isFile()) throw new Error(`CodeArts 数据库路径不是文件：${dbPath}`);
  return stat;
}
function openNativeDbReadonly(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true });
}
function openNativeDbWritable(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(dbPath);
}
async function openSqlJsDbReadonly(dbPath) {
  let initSqlJs;
  try { initSqlJs = require('sql.js'); }
  catch { initSqlJs = require('../node_modules/sql.js/dist/sql-wasm.js'); }
  const SQL = await initSqlJs({
    locateFile: (file) => {
      const local = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
      if (fs.existsSync(local)) return local;
      try { return require.resolve(`sql.js/dist/${file}`); }
      catch { return path.join(path.dirname(require.resolve('sql.js')), file); }
    },
  });
  return new SQL.Database(fs.readFileSync(dbPath));
}
function nativeAll(db, sql) { return db.prepare(sql).all(); }
function nativeAllParams(db, sql, params = []) { return db.prepare(sql).all(...params); }
function sqlJsAll(db, sql) {
  const stmt = db.prepare(sql);
  const rows = [];
  try { while (stmt.step()) rows.push(stmt.getAsObject()); }
  finally { stmt.free(); }
  return rows;
}
function sqlJsAllParams(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally { stmt.free(); }
  return rows;
}
function closeDb(db) { if (db && typeof db.close === 'function') db.close(); }
function validateTables(tables) { for (const required of ['message', 'session']) if (!tables.includes(required)) throw new Error(`数据库缺少 ${required} 表`); }
function tagRows(rows, source) { return rows.map((r) => ({ ...r, source: source.id, sourceLabel: source.label, dbPath: source.dbPath })); }
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
function mergeCollections(collections, adapter = 'mixed') {
  const existing = collections.filter(Boolean);
  if (!existing.length) throw new Error('没有可读取的 CodeArts 数据源');
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
function pageBounds(payload = {}, defaultLimit = 100) {
  const limit = Math.max(1, Math.min(500, Number(payload.limit || defaultLimit)));
  const offset = Math.max(0, Number(payload.offset || 0));
  return { limit, offset };
}
function normalizeRange(range = {}) {
  const start = Number(range.start || 0);
  const end = Number(range.end || 0);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    end: Number.isFinite(end) && end > 0 ? end : 0,
  };
}
function sourceMatchesPayload(source, payload = {}) {
  return !payload.source || payload.source === 'all' || payload.source === source.id;
}
function likeParam(value) { return `%${String(value || '').trim()}%`; }
function assistantWhere(payload = {}) {
  const where = ["(data like '%\"role\":\"assistant\"%' or data like '%\"role\": \"assistant\"%')"];
  const params = [];
  const { start, end } = normalizeRange(payload.range);
  if (start) { where.push('time_created >= ?'); params.push(start); }
  if (end) { where.push('time_created <= ?'); params.push(end); }
  const q = String(payload.query || '').trim();
  if (q) {
    where.push('(session_id like ? or data like ?)');
    params.push(likeParam(q), likeParam(q));
  }
  if (payload.model && payload.model !== 'all') {
    where.push('data like ?');
    params.push(likeParam(payload.model));
  }
  return { where: where.join(' and '), params };
}
function sessionWhere(payload = {}) {
  const where = [];
  const params = [];
  const { start, end } = normalizeRange(payload.range);
  if (start) { where.push('time_updated >= ?'); params.push(start); }
  if (end) { where.push('time_updated <= ?'); params.push(end); }
  if (payload.status === 'active') where.push('time_archived is null');
  else if (payload.status === 'archived') where.push('time_archived is not null');
  if (payload.project && payload.project !== 'all') { where.push('directory = ?'); params.push(payload.project); }
  const q = String(payload.query || '').trim();
  if (q) {
    where.push('(id like ? or title like ? or directory like ?)');
    params.push(likeParam(q), likeParam(q), likeParam(q));
  }
  return { where: where.length ? where.join(' and ') : '1=1', params };
}
function placeholders(list) { return list.map(() => '?').join(','); }
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
  if (!messageIds.length) return [];
  const sql = `select id, message_id, session_id, time_created, time_updated, data from part where message_id in (${placeholders(messageIds)}) order by time_created asc`;
  return tagRows(queryAll(db, sql, messageIds), source);
}
function querySessionsByIds(queryAll, db, source, sessionIds) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return [];
  const sql = `select id, title, directory, version, time_created, time_updated, time_archived from session where id in (${placeholders(ids)})`;
  return tagRows(queryAll(db, sql, ids), source);
}
function queryMessagesForSessions(queryAll, db, source, sessionIds) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return [];
  const sql = `select id, session_id, time_created, time_updated, data from message where session_id in (${placeholders(ids)}) order by time_created desc`;
  return tagRows(queryAll(db, sql, ids), source);
}
function pageResult(items, total, payload, defaultLimit) {
  const { limit, offset } = pageBounds(payload, defaultLimit);
  return { ok: true, limit, offset, total, hasMore: offset + items.length < total, items };
}
function collectRowsNative(options = {}) {
  const sources = listDataSources(options);
  const out = [];
  const errors = [];
  for (const source of sources) {
    try { out.push(collectOneNative(source)); }
    catch (error) { errors.push({ source, error: error.message }); }
  }
  const merged = mergeCollections(out, 'node:sqlite');
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
  const merged = mergeCollections(out, 'sql.js');
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
function getRequestsPageNative(payload = {}) {
  const { limit, offset } = pageBounds(payload, 100);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = openNativeDbReadonly(source.dbPath);
      const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = assistantWhere(payload);
      const count = nativeAllParams(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawMessages = nativeAllParams(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc limit ? offset ?`, [...params, offset + limit, 0]);
      const messages = tagRows(rawMessages, source);
      const sessions = querySessionsByIds(nativeAllParams, db, source, messages.map((m) => m.session_id));
      const parts = tables.includes('part') ? queryPartsForMessages(nativeAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...requestRowsFromMessages(messages, sessions, parts));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 100);
}
async function getRequestsPageSqlJs(payload = {}) {
  const { limit, offset } = pageBounds(payload, 100);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    const db = await openSqlJsDbReadonly(source.dbPath);
    try {
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = assistantWhere(payload);
      const count = sqlJsAllParams(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawMessages = sqlJsAllParams(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc limit ? offset ?`, [...params, offset + limit, 0]);
      const messages = tagRows(rawMessages, source);
      const sessions = querySessionsByIds(sqlJsAllParams, db, source, messages.map((m) => m.session_id));
      const parts = tables.includes('part') ? queryPartsForMessages(sqlJsAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...requestRowsFromMessages(messages, sessions, parts));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 100);
}
async function getRequestsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getRequestsPageNative(payload); }
    catch (error) {
      const page = await getRequestsPageSqlJs(payload);
      page.nativeError = error.message;
      return page;
    }
  }
  const page = await getRequestsPageSqlJs(payload);
  page.nativeError = 'CODEARTS_BAR_FORCE_SQLJS=1';
  return page;
}
function getSessionsPageNative(payload = {}) {
  const { limit, offset } = pageBounds(payload, 80);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = openNativeDbReadonly(source.dbPath);
      const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = sessionWhere(payload);
      const count = nativeAllParams(db, `select count(*) as count from session where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawSessions = nativeAllParams(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc limit ? offset ?`, [...params, offset + limit, 0]);
      const sessions = tagRows(rawSessions, source);
      const messages = queryMessagesForSessions(nativeAllParams, db, source, sessions.map((s) => s.id));
      const parts = tables.includes('part') ? queryPartsForMessages(nativeAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...sessionsFromRows(sessions, messages, parts, Date.now()));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 80);
}
async function getSessionsPageSqlJs(payload = {}) {
  const { limit, offset } = pageBounds(payload, 80);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    const db = await openSqlJsDbReadonly(source.dbPath);
    try {
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = sessionWhere(payload);
      const count = sqlJsAllParams(db, `select count(*) as count from session where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawSessions = sqlJsAllParams(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc limit ? offset ?`, [...params, offset + limit, 0]);
      const sessions = tagRows(rawSessions, source);
      const messages = queryMessagesForSessions(sqlJsAllParams, db, source, sessions.map((s) => s.id));
      const parts = tables.includes('part') ? queryPartsForMessages(sqlJsAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...sessionsFromRows(sessions, messages, parts, Date.now()));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 80);
}
async function getSessionsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSessionsPageNative(payload); }
    catch (error) {
      const page = await getSessionsPageSqlJs(payload);
      page.nativeError = error.message;
      return page;
    }
  }
  const page = await getSessionsPageSqlJs(payload);
  page.nativeError = 'CODEARTS_BAR_FORCE_SQLJS=1';
  return page;
}
function parseLogTimestamp(line) {
  const m = line.match(/INFO\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}
function extractJsonArray(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
function decodeQueuePayload(text) {
  const candidates = [];
  let pos = 0;
  while (pos >= 0 && pos < text.length) {
    const start = text.indexOf('[{', pos);
    if (start < 0) break;
    const raw = extractJsonArray(text, start);
    if (raw) candidates.push(raw);
    pos = start + 2;
  }
  for (const raw of candidates.reverse()) {
  try {
    const arr = JSON.parse(raw);
    const head = arr && arr[0];
    if (!head || typeof head !== 'object') return null;
      if (!('status' in head) && !('queue_length' in head) && !('queue_position' in head)) continue;
    const val = (key) => {
      const pointer = head[key];
      if (typeof pointer === 'string' && /^\d+$/.test(pointer)) return arr[Number(pointer)];
      return pointer;
    };
    const taskId = String(val('task_id') || '');
    const sessionId = taskId.match(/(ses_[A-Za-z0-9]+)/)?.[1] || null;
    return {
      taskId,
      sessionId,
      model: val('model') || null,
      status: val('status') || null,
      queueLength: Number(head.queue_length || 0),
      queuePosition: Number(head.queue_position || 0),
      message: val('message') || '',
    };
  } catch {
      continue;
    }
  }
  return null;
}
function scanQueueLogs(logRoot) {
  const roots = logRoot ? [logRoot] : SOURCE_DEFS.map((s) => s.logRoot);
  const pollEvents = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const files = fs.readdirSync(root).filter((f) => f.endsWith('.log')).sort().slice(-250);
      for (const f of files) {
        const fp = path.join(root, f);
        const st = fs.statSync(fp);
        if (st.size > 15 * 1024 * 1024) continue;
        const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!/inferhub-queue/.test(line) || !/Polling params/.test(line)) continue;
          const at = parseLogTimestamp(line);
          const payloadText = [line, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join('\n');
          const decoded = decodeQueuePayload(payloadText);
          if (!decoded || !decoded.sessionId || !decoded.status) continue;
          pollEvents.push({ ...decoded, at, file: f, line: i + 1, logRoot: root });
        }
      }
    } catch {}
  }
  pollEvents.sort((a, b) => (a.at || 0) - (b.at || 0));
  const episodes = [];
  const active = new Map();
  for (const event of pollEvents) {
    const key = event.taskId || `${event.sessionId}:${event.model || ''}`;
    if (event.status === 'waiting') {
      const current = active.get(key) || { taskId: event.taskId, sessionId: event.sessionId, model: event.model, start: event.at, end: null, queueLengthMax: 0, queuePositionStart: event.queuePosition || 0, queuePositionLast: event.queuePosition || 0, polls: 0, message: event.message, sourceFile: event.file };
      current.start = Math.min(current.start || event.at, event.at || current.start);
      current.queueLengthMax = Math.max(current.queueLengthMax || 0, event.queueLength || 0);
      if (!current.queuePositionStart) current.queuePositionStart = event.queuePosition || 0;
      current.queuePositionLast = event.queuePosition || current.queuePositionLast || 0;
      current.polls += 1;
      current.message = event.message || current.message;
      active.set(key, current);
    } else if (event.status === 'working' || event.status === 'delete working queue success') {
      const current = active.get(key);
      if (current && event.at && current.start && event.at >= current.start) {
        current.end = event.at;
        current.durationMs = event.at - current.start;
        current.status = event.status;
        episodes.push(current);
        active.delete(key);
      }
    }
  }
  return episodes.filter((x) => Number.isFinite(x.durationMs) && x.durationMs >= 0);
}
function scanTtftLogs(logRoot) {
  const roots = logRoot ? [logRoot] : SOURCE_DEFS.map((s) => s.logRoot);
  const out = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const files = fs.readdirSync(root).filter((f) => f.endsWith('.log')).sort().slice(-250);
      for (const f of files) {
        const fp = path.join(root, f);
        const st = fs.statSync(fp);
        if (st.size > 12 * 1024 * 1024) continue;
        const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!/Infer stream first token generated in/.test(line)) continue;
          const session = line.match(/\[(ses_[^\]]+)\]/)?.[1] || null;
          const req = line.match(/\]\s+\[([^\]]+)\]\s+Infer/)?.[1] || null;
          const ms = Number(line.match(/generated in\s+(\d+)ms/)?.[1]);
          const at = Number(line.match(/\sat\s+(\d{10,})/)?.[1]);
          out.push({ sessionId: session, requestId: req, ttftMs: ms, firstTokenAt: at || parseLogTimestamp(line), file: f, line: i + 1, logRoot: root });
        }
      }
    } catch {}
  }
  return out.filter((x) => x.sessionId && Number.isFinite(x.ttftMs));
}
function readCodeArtsConfig(configPath = path.join(os.homedir(), '.codeartsdoer', 'codearts_cli.json')) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const providers = data.provider || {};
    return {
      path: configPath,
      exists: true,
      enabledProviders: data.enabled_providers || [],
      plugins: data.plugin || [],
      providers: Object.entries(providers).map(([id, p]) => ({ id, name: p.name || id, baseURL: p.options?.baseURL || null, modelCount: p.models ? Object.keys(p.models).length : 0, hasApiKey: Boolean(p.options?.apiKey) })),
      officialQuota: {
        available: Boolean(process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK),
        source: 'codearts stats',
        status: process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK ? 'env_configured' : 'missing_CODEARTS_CLI_AK_SK',
      },
    };
  } catch (error) {
    return { path: configPath, exists: false, error: error.message, enabledProviders: [], plugins: [], providers: [], officialQuota: { available: false, source: 'codearts stats', status: 'config_unreadable' } };
  }
}
function detectProcesses() {
  return {
    expectedExe: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'CodeArts Agent', 'codearts-agent.exe'),
    cli: path.join(os.homedir(), '.codeartsdoer', 'installers', 'codearts.cmd'),
  };
}
async function archiveSession({ dbPath, id, archived = true }) {
  if (!id) throw new Error('缺少会话 ID');
  const source = dbPath ? sourceForDb(dbPath) : SOURCE_DEFS.find((s) => fs.existsSync(s.dbPath));
  if (!source || !fs.existsSync(source.dbPath)) throw new Error('找不到会话数据库');
  let db;
  try {
    db = openNativeDbWritable(source.dbPath);
    const now = Date.now();
    db.prepare('update session set time_archived = ?, time_updated = ? where id = ?').run(archived ? now : null, now, id);
    try { fs.writeFileSync(`${source.dbPath}.touch`, '', 'utf8'); } catch {}
    return { ok: true, id, archived, dbPath: source.dbPath, time: now };
  } catch (error) {
    return archiveSessionSqlJs({ source, id, archived, nativeError: error.message });
  } finally { closeDb(db); }
}
async function archiveSessionSqlJs({ source, id, archived, nativeError }) {
  // Electron 31 may not expose node:sqlite.  Keep session management usable by
  // falling back to sql.js and exporting the DB.  This is only used for the
  // explicit "归档" button; normal realtime reads remain read-only.
  let initSqlJs;
  try { initSqlJs = require('sql.js'); }
  catch { initSqlJs = require('../node_modules/sql.js/dist/sql-wasm.js'); }
  const SQL = await initSqlJs({
    locateFile: (file) => {
      const local = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
      if (fs.existsSync(local)) return local;
      try { return require.resolve(`sql.js/dist/${file}`); }
      catch { return path.join(path.dirname(require.resolve('sql.js')), file); }
    },
  });
  const database = new SQL.Database(fs.readFileSync(source.dbPath));
  try {
    const now = Date.now();
    const stmt = database.prepare('update session set time_archived = ?, time_updated = ? where id = ?');
    stmt.run([archived ? now : null, now, id]);
    stmt.free();
    fs.copyFileSync(source.dbPath, `${source.dbPath}.bak-${now}`);
    fs.writeFileSync(source.dbPath, Buffer.from(database.export()));
    try { fs.writeFileSync(`${source.dbPath}.touch`, '', 'utf8'); } catch {}
    return { ok: true, id, archived, dbPath: source.dbPath, time: now, fallback: 'sql.js' };
  } finally {
    database.close();
  }
}

async function renameSession({ dbPath, id, title }) {
  if (!id) throw new Error('\u7f3a\u5c11\u4f1a\u8bdd ID');
  const nextTitle = String(title || '').trim().slice(0, 200);
  if (!nextTitle) throw new Error('\u4f1a\u8bdd\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a');
  const source = dbPath ? sourceForDb(dbPath) : SOURCE_DEFS.find((s) => fs.existsSync(s.dbPath));
  if (!source || !fs.existsSync(source.dbPath)) throw new Error('\u627e\u4e0d\u5230\u4f1a\u8bdd\u6570\u636e\u5e93');
  let db;
  try {
    db = openNativeDbWritable(source.dbPath);
    const now = Date.now();
    db.prepare('update session set title = ?, time_updated = ? where id = ?').run(nextTitle, now, id);
    try { fs.writeFileSync(`${source.dbPath}.touch`, '', 'utf8'); } catch {}
    return { ok: true, id, title: nextTitle, dbPath: source.dbPath, time: now };
  } catch (error) {
    return renameSessionSqlJs({ source, id, title: nextTitle, nativeError: error.message });
  } finally { closeDb(db); }
}
async function renameSessionSqlJs({ source, id, title, nativeError }) {
  let initSqlJs;
  try { initSqlJs = require('sql.js'); }
  catch { initSqlJs = require('../node_modules/sql.js/dist/sql-wasm.js'); }
  const SQL = await initSqlJs({
    locateFile: (file) => {
      const local = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file);
      if (fs.existsSync(local)) return local;
      try { return require.resolve(`sql.js/dist/${file}`); }
      catch { return path.join(path.dirname(require.resolve('sql.js')), file); }
    },
  });
  const database = new SQL.Database(fs.readFileSync(source.dbPath));
  try {
    const now = Date.now();
    const stmt = database.prepare('update session set title = ?, time_updated = ? where id = ?');
    stmt.run([title, now, id]);
    stmt.free();
    fs.copyFileSync(source.dbPath, `${source.dbPath}.bak-${now}`);
    fs.writeFileSync(source.dbPath, Buffer.from(database.export()));
    try { fs.writeFileSync(`${source.dbPath}.touch`, '', 'utf8'); } catch {}
    return { ok: true, id, title, dbPath: source.dbPath, time: now, fallback: 'sql.js' };
  } finally {
    database.close();
  }
}

function watchTargets(options = {}) {
  const out = new Set();
  for (const source of listDataSources(options)) {
    for (const file of [source.dbPath, `${source.dbPath}-wal`, `${source.dbPath}-shm`, `${source.dbPath}.touch`]) out.add(file);
    out.add(path.dirname(source.dbPath));
    out.add(source.logRoot);
    out.add(path.join(path.dirname(source.dbPath), 'storage', 'session_diff'));
  }
  return [...out];
}

module.exports = { DEFAULT_DB_PATH, CLI_DB_PATH, SOURCE_DEFS, listDataSources, watchTargets, resolveDbPath, ensureReadableDb, collectRowsNative, collectRowsSqlJs, collectRows, getRequestsPage, getSessionsPage, scanTtftLogs, scanQueueLogs, readCodeArtsConfig, detectProcesses, archiveSession, renameSession };
