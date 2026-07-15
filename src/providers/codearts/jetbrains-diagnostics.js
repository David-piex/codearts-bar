'use strict';

function safeDbError(error) {
  const text = String(error?.message || error || '').trim();
  if (/^self-test requires --(?:fixture-db|config-dir|now-ms)\b/i.test(text)) return text.slice(0, 180);
  if (/ENOENT|no such file|not found|不存在|missing/i.test(text)) return '数据源 数据库不存在';
  if (/EACCES|EPERM|permission|权限|access denied/i.test(text)) return '数据源 数据库无读取权限';
  if (/malformed|corrupt|database disk image|file is not a database|缺少.*表|no such table|schema/i.test(text)) return '数据源 数据库结构异常';
  if (/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(text)) return '数据源 数据库暂时被占用';
  return '数据源 数据源异常';
}

function getDatabaseDiagnostics() { return {}; }

module.exports = { safeDbError, getDatabaseDiagnostics };
