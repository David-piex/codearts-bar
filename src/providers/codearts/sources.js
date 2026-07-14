'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSettings } = require('../../settings');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'opencode.db');
const CLI_DB_PATH = path.join(os.homedir(), '.codeartsdoer', 'cli-data', 'opencode.db');
const SOURCE_DEFS = [
  { id: 'desktop', label: '桌面端', dbPath: DEFAULT_DB_PATH, logRoot: path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'log') },
  { id: 'cli', label: 'CLI', dbPath: CLI_DB_PATH, logRoot: path.join(os.homedir(), '.codeartsdoer', 'cli-data', 'log') },
];

function savedDbPath(options = {}) { return options.useSavedSettings === false ? '' : loadSettings().dbPath; }
function resolveDbPath(options = {}) { return options.dbPath || process.env.CODEARTS_BAR_DB || savedDbPath(options) || DEFAULT_DB_PATH; }
function sourceForDb(dbPath) { return SOURCE_DEFS.find((s) => path.resolve(s.dbPath).toLowerCase() === path.resolve(dbPath).toLowerCase()) || { id: 'custom', label: '自定义', dbPath, logRoot: path.join(path.dirname(dbPath), 'log') }; }
function listDataSources(options = {}) {
  const configuredDbPath = savedDbPath(options);
  const candidates = [options.dbPath, process.env.CODEARTS_BAR_DB, configuredDbPath].filter(Boolean);
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
function validateTables(tables) { for (const required of ['message', 'session']) if (!tables.includes(required)) throw new Error(`数据库缺少 ${required} 表`); }
function tagRows(rows, source) { return rows.map((r) => ({ ...r, source: source.id, sourceLabel: source.label, dbPath: source.dbPath })); }
function pageBounds(payload = {}, defaultLimit = 100) {
  const limit = Math.max(1, Math.min(500, Number(payload.limit || defaultLimit)));
  const offset = Math.max(0, Number(payload.offset || 0));
  return { limit, offset };
}
function normalizeRange(range = {}) {
  const start = Number(range.start || 0);
  const end = Number(range.endExclusive ?? range.end ?? 0);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    end: Number.isFinite(end) && end > 0 ? end : 0,
  };
}
function resolveTimestamp(options = {}) {
  if (options.timestamp !== undefined && options.timestamp !== null && options.timestamp !== '') {
    const explicit = Number(options.timestamp);
    if (Number.isFinite(explicit)) return explicit;
  }
  if (typeof options.clock === 'function') {
    const value = Number(options.clock());
    if (Number.isFinite(value)) return value;
  }
  if (options.clock && typeof options.clock.now === 'function') {
    const value = Number(options.clock.now());
    if (Number.isFinite(value)) return value;
  }
  const env = Number(process.env.CODEARTS_BAR_NOW_MS);
  return Number.isFinite(env) && env > 0 ? env : Date.now();
}
function sourceMatchesPayload(source, payload = {}) {
  return !payload.source || payload.source === 'all' || payload.source === source.id;
}
function likeParam(value) { return `%${String(value || '').trim()}%`; }
function jsonExtractExpr(column, path) {
  return `case when json_valid(${column}) then json_extract(${column}, '${path}') end`;
}
function jsonTypeExpr(column, path) {
  return `case when json_valid(${column}) then json_type(${column}, '${path}') end`;
}
function messageModelExpr(column = 'data') {
  return `coalesce(${jsonExtractExpr(column, '$.modelID')}, ${jsonExtractExpr(column, '$.model.modelID')})`;
}
function messageErrorExpr(column = 'data') {
  const type = jsonTypeExpr(column, '$.error');
  const value = jsonExtractExpr(column, '$.error');
  return `(case
    when ${type} in ('object', 'array') then 1
    when ${type} = 'text' and length(trim(cast(${value} as text))) > 0 then 1
    when ${type} in ('integer', 'real', 'true') and coalesce(cast(${value} as real), 1) <> 0 then 1
    else 0
  end)`;
}
function assistantWhere(payload = {}) {
  const where = [`${jsonExtractExpr('data', '$.role')} = ?`];
  const params = ['assistant'];
  const { start, end } = normalizeRange(payload.range);
  if (start) { where.push('time_created >= ?'); params.push(start); }
  if (end) { where.push('time_created < ?'); params.push(end); }
  const updatedSince = Number(payload.updatedSince || 0);
  if (Number.isFinite(updatedSince) && updatedSince > 0) {
    where.push('coalesce(time_updated, time_created) >= ?');
    params.push(updatedSince);
  }
  const sessionId = String(payload.sessionId || '').trim();
  if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
  const q = String(payload.query || '').trim();
  if (q) {
    where.push('(session_id like ? or data like ?)');
    params.push(likeParam(q), likeParam(q));
  }
  if (payload.model && payload.model !== 'all') {
    where.push(`${messageModelExpr('data')} = ?`);
    params.push(String(payload.model));
  }
  const errorFilter = payload.error ?? payload.hasError ?? payload.errorsOnly;
  if (errorFilter === true || errorFilter === 'only' || errorFilter === 'error') where.push(`${messageErrorExpr('data')} = 1`);
  else if (errorFilter === false || errorFilter === 'none' || errorFilter === 'success') where.push(`${messageErrorExpr('data')} = 0`);
  return { where: where.join(' and '), params };
}
function sessionWhere(payload = {}) {
  const where = [];
  const params = [];
  const { start, end } = normalizeRange(payload.range);
  if (start) { where.push('time_updated >= ?'); params.push(start); }
  if (end) { where.push('time_updated < ?'); params.push(end); }
  if (payload.status === 'active') where.push('time_archived is null');
  else if (payload.status === 'archived') where.push('time_archived is not null');
  if (payload.project && payload.project !== 'all') { where.push('directory = ?'); params.push(payload.project); }
  if (payload.model && payload.model !== 'all') {
    where.push(`exists (
      select 1 from message session_message
      where session_message.session_id = session.id
        and ${jsonExtractExpr('session_message.data', '$.role')} = 'assistant'
        and ${messageModelExpr('session_message.data')} = ?
    )`);
    params.push(String(payload.model));
  }
  const q = String(payload.query || '').trim();
  if (q) {
    where.push('(id like ? or title like ? or directory like ?)');
    params.push(likeParam(q), likeParam(q), likeParam(q));
  }
  return { where: where.length ? where.join(' and ') : '1=1', params };
}
function placeholders(list) { return list.map(() => '?').join(','); }
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

module.exports = {
  DEFAULT_DB_PATH,
  CLI_DB_PATH,
  SOURCE_DEFS,
  resolveDbPath,
  sourceForDb,
  listDataSources,
  ensureReadableDb,
  validateTables,
  tagRows,
  pageBounds,
  normalizeRange,
  resolveTimestamp,
  sourceMatchesPayload,
  likeParam,
  jsonExtractExpr,
  jsonTypeExpr,
  messageModelExpr,
  messageErrorExpr,
  assistantWhere,
  sessionWhere,
  placeholders,
  watchTargets,
};
