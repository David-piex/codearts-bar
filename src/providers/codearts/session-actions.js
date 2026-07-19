'use strict';

const fs = require('node:fs');
const { SOURCE_DEFS, sourceForDb, resolveTimestamp } = require('./sources');
const { openNativeDbWritable, closeDb } = require('./sqlite');

const DEFAULT_BUSY_TIMEOUT_MS = 750;
const DEFAULT_BUSY_RETRY_DELAYS_MS = [40, 120, 280];

function selectedSource(dbPath) {
  const source = dbPath ? sourceForDb(dbPath) : SOURCE_DEFS.find((item) => fs.existsSync(item.dbPath));
  if (!source || !fs.existsSync(source.dbPath)) throw new Error('找不到会话数据库');
  return source;
}

function isBusyError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || /SQLITE_(?:BUSY|LOCKED)|database is (?:busy|locked)/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function rollbackQuietly(db) {
  try { db?.exec('rollback'); } catch {}
}

async function runNativeWrite(source, operation, options = {}) {
  const delays = Array.isArray(options.busyRetryDelaysMs)
    ? options.busyRetryDelaysMs.map(Number).filter((value) => Number.isFinite(value) && value >= 0)
    : DEFAULT_BUSY_RETRY_DELAYS_MS;
  const busyTimeoutMs = Math.max(0, Math.min(5000, Number(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS) || 0));
  let lastError;
  let attempts = 0;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    attempts = attempt + 1;
    let db;
    try {
      db = openNativeDbWritable(source.dbPath);
      db.exec(`pragma busy_timeout = ${busyTimeoutMs}`);
      db.exec('begin immediate');
      const result = operation(db);
      db.exec('commit');
      return { result, attempts: attempt + 1 };
    } catch (error) {
      rollbackQuietly(db);
      lastError = error;
      if (!isBusyError(error) || attempt >= delays.length) break;
    } finally {
      closeDb(db);
    }
    await sleep(delays[attempt]);
  }
  const reason = lastError?.message || String(lastError || 'unknown error');
  const error = new Error(`原生 SQLite 写入失败，未修改数据库：${reason}`, { cause: lastError });
  error.code = isBusyError(lastError) ? 'SQLITE_WRITE_BUSY' : 'SQLITE_WRITE_FAILED';
  error.attempts = attempts;
  throw error;
}

function writeTouchFile(dbPath) {
  try { fs.writeFileSync(`${dbPath}.touch`, '', 'utf8'); } catch {}
}

async function archiveSession({ dbPath, id, archived = true, ...options }) {
  if (!id) throw new Error('缺少会话 ID');
  const source = selectedSource(dbPath);
  const now = resolveTimestamp(options);
  const { result, attempts } = await runNativeWrite(source, (db) => db
    .prepare('update session set time_archived = ?, time_updated = ? where id = ?')
    .run(archived ? now : null, now, id), options);
  if (Number(result?.changes || 0) < 1) throw new Error(`会话不存在：${id}`);
  writeTouchFile(source.dbPath);
  return { ok: true, id, archived, dbPath: source.dbPath, time: now, attempts };
}

async function archiveSessions({ sessions, archived = true, ...options }) {
  const items = Array.isArray(sessions) ? sessions : [];
  if (!items.length) throw new Error('缺少会话');
  if (items.length > 500) throw new Error('批量归档最多支持 500 个会话');
  const nextArchived = archived !== false;

  const unresolvedGroups = new Map();
  for (const item of items) {
    const id = String(item?.id || '').trim();
    if (!id) throw new Error('缺少会话 ID');
    const dbPath = String(item?.dbPath || '').trim();
    const key = dbPath.toLowerCase() || '<auto>';
    const group = unresolvedGroups.get(key) || { dbPath, ids: new Set() };
    group.ids.add(id);
    unresolvedGroups.set(key, group);
  }
  const groups = [...unresolvedGroups.values()].map((group) => ({ source: selectedSource(group.dbPath), ids: group.ids }));

  const now = resolveTimestamp(options);
  let count = 0;
  let attempts = 0;
  for (const { source, ids } of groups) {
    const result = await runNativeWrite(source, (db) => {
      const statement = db.prepare('update session set time_archived = ?, time_updated = ? where id = ?');
      let changes = 0;
      for (const id of ids) {
        const row = statement.run(nextArchived ? now : null, now, id);
        if (Number(row?.changes || 0) < 1) {
          const error = new Error(`会话不存在：${id}`);
          error.code = 'SESSION_NOT_FOUND';
          throw error;
        }
        changes += Number(row.changes || 0);
      }
      return changes;
    }, options);
    writeTouchFile(source.dbPath);
    count += Number(result.result || 0);
    attempts += Number(result.attempts || 0);
  }
  return { ok: true, archived: nextArchived, count, time: now, attempts, sources: groups.length };
}

async function renameSession({ dbPath, id, title, ...options }) {
  if (!id) throw new Error('缺少会话 ID');
  const nextTitle = String(title || '').trim().slice(0, 200);
  if (!nextTitle) throw new Error('会话名称不能为空');
  const source = selectedSource(dbPath);
  const now = resolveTimestamp(options);
  const { result, attempts } = await runNativeWrite(source, (db) => db
    .prepare('update session set title = ?, time_updated = ? where id = ?')
    .run(nextTitle, now, id), options);
  if (Number(result?.changes || 0) < 1) throw new Error(`会话不存在：${id}`);
  writeTouchFile(source.dbPath);
  return { ok: true, id, title: nextTitle, dbPath: source.dbPath, time: now, attempts };
}

module.exports = {
  archiveSession,
  archiveSessions,
  renameSession,
  isBusyError,
  runNativeWrite,
};
