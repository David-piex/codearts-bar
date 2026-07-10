'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SOURCE_DEFS,
  resolveDbPath,
  sourceForDb,
  sourceMatchesPayload,
} = require('./sources');
const { sqliteRuntimeStatus } = require('./sqlite');

function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
function stat(file) { try { return fs.statSync(file); } catch { return null; } }
function canRead(file) { try { fs.accessSync(file, fs.constants.R_OK); return true; } catch { return false; } }

function issue(tone, code, title, detail, extra = {}) {
  return { tone, code, title, detail, ...extra };
}

function classifyDatabaseError(message = '', source = {}) {
  const text = String(message || '');
  const label = source.label || source.source || source.id || '数据源';
  if (/ENOENT|no such file|not found|不存在|missing/i.test(text)) {
    return issue('bad', 'database_missing', `${label} 数据库不存在`, `没有找到 ${source.dbPath || 'opencode.db'}。请先启动 CodeArts Agent / CLI 产生会话，或在设置里选择正确路径。`, { source: source.id || source.source, dbPath: source.dbPath, raw: text });
  }
  if (/EACCES|EPERM|permission|权限|access denied/i.test(text)) {
    return issue('bad', 'database_permission', `${label} 数据库无读取权限`, `当前用户没有读取 ${source.dbPath || 'opencode.db'} 的权限。请检查目录权限，或用普通用户重新启动应用。`, { source: source.id || source.source, dbPath: source.dbPath, raw: text });
  }
  if (/malformed|corrupt|database disk image|file is not a database|缺少.*表|no such table|schema/i.test(text)) {
    return issue('bad', 'database_corrupt_or_schema', `${label} 数据库结构异常`, `数据库可能损坏、版本不兼容或缺少 message/session 表。建议先备份数据库，再打开日志查看具体错误。`, { source: source.id || source.source, dbPath: source.dbPath, raw: text });
  }
  if (/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(text)) {
    return issue('warn', 'database_locked', `${label} 数据库暂时被占用`, `CodeArts 可能正在写入数据库。稍后刷新即可；如果持续出现，请重启 CodeArts Agent / CLI。`, { source: source.id || source.source, dbPath: source.dbPath, raw: text });
  }
  return issue('warn', 'database_unknown', `${label} 数据源异常`, text || '读取数据源时出现未知异常。', { source: source.id || source.source, dbPath: source.dbPath, raw: text });
}

function expectedSources(payload = {}) {
  const explicit = payload.dbPath || process.env.CODEARTS_BAR_DB;
  if (explicit) return [{ ...sourceForDb(explicit), dbPath: explicit }];
  const selected = SOURCE_DEFS.filter((source) => sourceMatchesPayload(source, payload));
  return selected.length ? selected : SOURCE_DEFS;
}

function dataSourceInstallIssue(payload = {}) {
  const root = path.join(os.homedir(), '.codeartsdoer');
  if (exists(root)) return null;
  if (payload.dbPath || process.env.CODEARTS_BAR_DB) return null;
  return issue(
    'warn',
    'codearts_not_installed',
    '未检测到 CodeArts 数据目录',
    `没有找到 ${root}。如果这是首次启动，请先运行 CodeArts Agent / CLI 并产生一次会话。`,
    { path: root }
  );
}

function sourceFileIssues(payload = {}) {
  const issues = [];
  for (const source of expectedSources(payload)) {
    const st = stat(source.dbPath);
    if (!st) {
      issues.push(classifyDatabaseError('ENOENT: database not found', source));
      continue;
    }
    if (!st.isFile()) {
      issues.push(issue('bad', 'database_path_not_file', `${source.label} 数据库路径不是文件`, `${source.dbPath} 不是一个可读取的 opencode.db 文件。`, { source: source.id, dbPath: source.dbPath }));
      continue;
    }
    if (!canRead(source.dbPath)) {
      issues.push(classifyDatabaseError('EACCES: permission denied', source));
      continue;
    }
    if (st.size === 0) {
      issues.push(issue('warn', 'database_empty_file', `${source.label} 数据库为空`, `${source.dbPath} 文件大小为 0。请先产生一次 CodeArts 会话，或检查数据库是否仍在初始化。`, { source: source.id, dbPath: source.dbPath }));
    }
  }
  return issues;
}

function healthIssues(health = {}) {
  const out = [];
  for (const error of health.sourceErrors || []) out.push(classifyDatabaseError(error.message || error.error, error));
  for (const item of health.items || []) {
    if (item.quickCheck && String(item.quickCheck).toLowerCase() !== 'ok') {
      out.push(issue('bad', 'database_quick_check_failed', `${item.label || item.source} 数据库 quick_check 异常`, String(item.quickCheck), { source: item.source, dbPath: item.dbPath }));
    }
    if (Number(item.messageCount || 0) === 0 && Number(item.sessionCount || 0) === 0) {
      out.push(issue('warn', 'database_no_records', `${item.label || item.source} 暂无会话数据`, '数据库可读取，但 message/session 都为空。请先在 CodeArts Agent / CLI 中产生一次会话。', { source: item.source, dbPath: item.dbPath }));
    }
  }
  if (health.nativeError) {
    out.push(issue('info', 'sqlite_fallback', '已切换到 sql.js 兼容模式', `node:sqlite 当前不可用或读取失败：${health.nativeError}`, { nativeError: health.nativeError }));
  }
  return out;
}

function runtimeIssues(runtime = sqliteRuntimeStatus()) {
  if (runtime.native?.available) return [];
  return [issue('info', 'node_sqlite_unavailable', 'node:sqlite 不可用，已准备 sql.js fallback', runtime.native?.error || '当前运行时不支持 node:sqlite。', { runtime })];
}

function dedupeIssues(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.code}:${item.source || ''}:${item.dbPath || ''}:${item.detail || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getDatabaseDiagnostics(payload = {}, health = null) {
  const runtime = sqliteRuntimeStatus();
  const issues = dedupeIssues([
    dataSourceInstallIssue(payload),
    ...sourceFileIssues(payload),
    ...healthIssues(health || {}),
    ...runtimeIssues(runtime),
  ].filter(Boolean));
  const active = issues.filter((item) => item.tone === 'bad' || item.tone === 'warn');
  return {
    ok: active.length === 0,
    timestamp: Date.now(),
    runtime,
    sources: expectedSources(payload).map((source) => {
      const st = stat(source.dbPath);
      return { id: source.id, label: source.label, dbPath: source.dbPath, exists: Boolean(st), size: st?.size || 0, readable: st ? canRead(source.dbPath) : false };
    }),
    issues,
  };
}

module.exports = { classifyDatabaseError, getDatabaseDiagnostics };
