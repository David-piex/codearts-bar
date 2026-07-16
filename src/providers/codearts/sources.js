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
function tableColumnNames(queryAll, db, tableName) {
  const safeName = String(tableName || '').replace(/[^A-Za-z0-9_]/g, '');
  if (!safeName) return new Set();
  return new Set(queryAll(db, `pragma table_info(${safeName})`, []).map((row) => String(row.name || '')).filter(Boolean));
}
function hasTableColumn(columns, name) {
  if (columns instanceof Set) return columns.has(name);
  return Array.isArray(columns) && columns.includes(name);
}
function topLevelSessionWhere(options = {}) {
  if (options.includeInternalSessions === true || !hasTableColumn(options.sessionColumns, 'parent_id')) return '1=1';
  const alias = String(options.sessionAlias || 'session').replace(/[^A-Za-z0-9_]/g, '') || 'session';
  return `(${alias}.parent_id is null or trim(${alias}.parent_id) = '')`;
}
function isInternalSession(row = {}) {
  return row.parent_id != null && String(row.parent_id).trim() !== '';
}
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
function filterValues(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((item) => String(item || '').trim()).filter((item) => item && item !== 'all'))];
}
function sourceMatchesPayload(source, payload = {}) {
  const selected = filterValues(payload.source);
  return !selected.length || selected.includes(source.id);
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
const MESSAGE_TOKEN_PATHS = {
  input: [
    '$.tokens.input', '$.tokens.inputTokens', '$.tokens.input_tokens', '$.tokens.prompt_tokens', '$.tokens.promptTokens',
    '$.usage.input', '$.usage.inputTokens', '$.usage.input_tokens', '$.usage.prompt_tokens', '$.usage.promptTokens',
    '$.input', '$.inputTokens', '$.input_tokens', '$.prompt_tokens', '$.promptTokens',
  ],
  output: [
    '$.tokens.output', '$.tokens.outputTokens', '$.tokens.output_tokens', '$.tokens.completion_tokens', '$.tokens.completionTokens',
    '$.usage.output', '$.usage.outputTokens', '$.usage.output_tokens', '$.usage.completion_tokens', '$.usage.completionTokens',
    '$.output', '$.outputTokens', '$.output_tokens', '$.completion_tokens', '$.completionTokens',
  ],
  reasoning: [
    '$.tokens.reasoning', '$.tokens.reasoningTokens', '$.tokens.reasoning_tokens',
    '$.usage.reasoning', '$.usage.reasoningTokens', '$.usage.reasoning_tokens',
    '$.reasoning', '$.reasoningTokens', '$.reasoning_tokens',
  ],
  cacheRead: [
    '$.tokens.cache.read', '$.tokens.cache.cache_read', '$.tokens.cacheRead', '$.tokens.cache_read', '$.tokens.cached_tokens', '$.tokens.cache_read_tokens',
    '$.usage.cache.read', '$.usage.cache.cache_read', '$.usage.cacheRead', '$.usage.cache_read', '$.usage.cached_tokens', '$.usage.cache_read_tokens',
    '$.cache.read', '$.cache.cache_read', '$.cacheRead', '$.cache_read', '$.cached_tokens', '$.cache_read_tokens',
  ],
  cacheWrite: [
    '$.tokens.cache.write', '$.tokens.cache.cache_write', '$.tokens.cacheWrite', '$.tokens.cache_write', '$.tokens.cache_creation_input_tokens', '$.tokens.cache_write_tokens',
    '$.usage.cache.write', '$.usage.cache.cache_write', '$.usage.cacheWrite', '$.usage.cache_write', '$.usage.cache_creation_input_tokens', '$.usage.cache_write_tokens',
    '$.cache.write', '$.cache.cache_write', '$.cacheWrite', '$.cache_write', '$.cache_creation_input_tokens', '$.cache_write_tokens',
  ],
  total: [
    '$.tokens.total', '$.tokens.totalTokens', '$.tokens.total_tokens',
    '$.usage.total', '$.usage.totalTokens', '$.usage.total_tokens',
    '$.total', '$.totalTokens', '$.total_tokens',
  ],
};
function messageTokenNonZeroExpr(column = 'data') {
  const paths = Object.values(MESSAGE_TOKEN_PATHS).flat();
  return `(${paths.map((p) => `coalesce(cast(${jsonExtractExpr(column, p)} as real), 0)`).join(' + ')}) > 0`;
}
function assistantWhere(payload = {}, options = {}) {
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
  const models = filterValues(payload.model);
  if (models.length) {
    where.push(`${messageModelExpr('data')} in (${placeholders(models)})`);
    params.push(...models);
  }
  const projects = filterValues(payload.project);
  if (projects.length) {
    const messageAlias = options.outerAlias || 'm';
    const includesNone = projects.includes('__none');
    const directories = projects.filter((item) => item !== '__none');
    const projectWhere = [];
    if (includesNone) projectWhere.push("project_session.directory is null or trim(project_session.directory) = ''");
    if (directories.length) {
      projectWhere.push(`project_session.directory in (${placeholders(directories)})`);
      params.push(...directories);
    }
    where.push(`exists (
      select 1 from session project_session
      where project_session.id = ${messageAlias}.session_id
        and (${projectWhere.map((item) => `(${item})`).join(' or ')})
    )`);
  }
  const errorFilter = payload.error ?? payload.hasError ?? payload.errorsOnly;
  if (errorFilter === true || errorFilter === 'only' || errorFilter === 'error') where.push(`${messageErrorExpr('data')} = 1`);
  else if (errorFilter === false || errorFilter === 'none' || errorFilter === 'success') where.push(`${messageErrorExpr('data')} = 0`);
  if (options.excludePlaceholders) {
    const hasPart = options.hasPart === true;
    const messageId = options.outerAlias ? `${options.outerAlias}.id` : 'id';
    const hasStepFinish = hasPart
      ? `exists (select 1 from part p where p.message_id = ${messageId} and ${jsonExtractExpr('p.data', '$.type')} = 'step-finish')`
      : '0';
    where.push(`not (not (${messageTokenNonZeroExpr('data')}) and ${messageErrorExpr('data')} = 0 and coalesce(cast(${jsonExtractExpr('data', '$.time.completed')} as real), 0) <= 0 and not (${hasStepFinish}))`);
  }
  return { where: where.join(' and '), params };
}
function sessionWhere(payload = {}, options = {}) {
  const where = [topLevelSessionWhere({ ...options, includeInternalSessions: payload.includeInternalSessions === true })];
  const params = [];
  const { start, end } = normalizeRange(payload.range);
  if (start) { where.push('time_updated >= ?'); params.push(start); }
  if (end) { where.push('time_updated < ?'); params.push(end); }
  if (payload.status === 'active') where.push('time_archived is null');
  else if (payload.status === 'archived') where.push('time_archived is not null');
  const projects = filterValues(payload.project);
  if (projects.length) {
    const includesNone = projects.includes('__none');
    const directories = projects.filter((item) => item !== '__none');
    const projectWhere = [];
    if (includesNone) projectWhere.push("directory is null or trim(directory) = ''");
    if (directories.length) {
      projectWhere.push(`directory in (${placeholders(directories)})`);
      params.push(...directories);
    }
    where.push(`(${projectWhere.map((item) => `(${item})`).join(' or ')})`);
  }
  const models = filterValues(payload.model);
  if (models.length) {
    const modelWhere = [
      `${jsonExtractExpr('session_message.data', '$.role')} = 'assistant'`,
      `${messageModelExpr('session_message.data')} in (${placeholders(models)})`,
    ];
    const modelParams = [...models];
    if (start) { modelWhere.push('session_message.time_created >= ?'); modelParams.push(start); }
    if (end) { modelWhere.push('session_message.time_created < ?'); modelParams.push(end); }
    where.push(`exists (
      select 1 from message session_message
      where session_message.session_id = session.id
        and ${modelWhere.join('\n        and ')}
    )`);
    params.push(...modelParams);
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
  tableColumnNames,
  topLevelSessionWhere,
  isInternalSession,
  pageBounds,
  normalizeRange,
  resolveTimestamp,
  filterValues,
  sourceMatchesPayload,
  likeParam,
  jsonExtractExpr,
  jsonTypeExpr,
  messageModelExpr,
  messageErrorExpr,
  MESSAGE_TOKEN_PATHS,
  messageTokenNonZeroExpr,
  assistantWhere,
  sessionWhere,
  placeholders,
  watchTargets,
};
