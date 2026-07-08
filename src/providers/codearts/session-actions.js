'use strict';

const fs = require('node:fs');
const { SOURCE_DEFS, sourceForDb } = require('./sources');
const { openNativeDbWritable, openSqlJsDbReadonly, closeDb } = require('./sqlite');

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
  let database = await openSqlJsDbReadonly(source.dbPath);
  try {
    const now = Date.now();
    const stmt = database.prepare('update session set time_archived = ?, time_updated = ? where id = ?');
    stmt.run([archived ? now : null, now, id]);
    stmt.free();
    fs.copyFileSync(source.dbPath, `${source.dbPath}.bak-${now}`);
    fs.writeFileSync(source.dbPath, Buffer.from(database.export()));
    try { fs.writeFileSync(`${source.dbPath}.touch`, '', 'utf8'); } catch {}
    return { ok: true, id, archived, dbPath: source.dbPath, time: now, fallback: 'sql.js', nativeError };
  } finally { database.close(); }
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
  let database = await openSqlJsDbReadonly(source.dbPath);
  try {
    const now = Date.now();
    const stmt = database.prepare('update session set title = ?, time_updated = ? where id = ?');
    stmt.run([title, now, id]);
    stmt.free();
    fs.copyFileSync(source.dbPath, `${source.dbPath}.bak-${now}`);
    fs.writeFileSync(source.dbPath, Buffer.from(database.export()));
    try { fs.writeFileSync(`${source.dbPath}.touch`, '', 'utf8'); } catch {}
    return { ok: true, id, title, dbPath: source.dbPath, time: now, fallback: 'sql.js', nativeError };
  } finally { database.close(); }
}
module.exports = { archiveSession, archiveSessionSqlJs, renameSession, renameSessionSqlJs };
