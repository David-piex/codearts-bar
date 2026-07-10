'use strict';

const fs = require('node:fs');
const path = require('node:path');

let nativeSqliteModule = null;
let nativeSqliteError = null;
let sqlJsReadyPromise = null;
const cachedSqlJsDbs = new Map();
const cachedSqlJsOpenPromises = new Map();
const cachedSqlJsDbSet = new WeakSet();
const SQLJS_DB_CACHE_LIMIT = 3;

function locateSqlJsFile(file) {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  try { return require.resolve(`sql.js/dist/${file}`); }
  catch {
    try { return path.join(path.dirname(require.resolve('sql.js')), file); }
    catch { return candidates[0]; }
  }
}
function loadSqlJsFactory() {
  try { return require('sql.js'); }
  catch {
    try { return require(locateSqlJsFile('sql-wasm.js')); }
    catch { return require('../../../node_modules/sql.js/dist/sql-wasm.js'); }
  }
}
function loadNativeSqliteModule() {
  if (nativeSqliteModule) return nativeSqliteModule;
  if (nativeSqliteError) throw nativeSqliteError;
  try {
    nativeSqliteModule = require('node:sqlite');
    return nativeSqliteModule;
  } catch (error) {
    nativeSqliteError = error;
    throw error;
  }
}
function nativeSqliteStatus() {
  try {
    const mod = loadNativeSqliteModule();
    return {
      available: true,
      adapter: 'node:sqlite',
      node: process.version,
      execPath: process.execPath,
      databaseSync: Boolean(mod && mod.DatabaseSync),
      experimental: true,
    };
  } catch (error) {
    return {
      available: false,
      adapter: 'sql.js',
      node: process.version,
      execPath: process.execPath,
      error: error && error.message ? error.message : String(error),
    };
  }
}
function sqliteRuntimeStatus() {
  const native = nativeSqliteStatus();
  return {
    preferred: native.available ? 'node:sqlite' : 'sql.js',
    native,
    fallback: { adapter: 'sql.js', available: true, wasm: locateSqlJsFile('sql-wasm.wasm') },
  };
}
async function getSqlJs() {
  if (!sqlJsReadyPromise) {
    const initSqlJs = loadSqlJsFactory();
    sqlJsReadyPromise = Promise.resolve(initSqlJs({ locateFile: locateSqlJsFile }));
  }
  return sqlJsReadyPromise;
}
function statFingerprint(file) {
  try {
    const st = fs.statSync(file);
    return `${file}:${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return `${file}:missing`;
  }
}
function sqliteFileFingerprint(dbPath) {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}.touch`];
  return files.map(statFingerprint).join('|');
}
function pruneSqlJsDbCache() {
  if (cachedSqlJsDbs.size <= SQLJS_DB_CACHE_LIMIT) return;
  const entries = [...cachedSqlJsDbs.entries()].sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
  for (const [key, entry] of entries.slice(0, Math.max(0, entries.length - SQLJS_DB_CACHE_LIMIT))) {
    try { entry.db?.close?.(); } catch {}
    cachedSqlJsDbs.delete(key);
  }
}
function openNativeDbReadonly(dbPath) {
  const { DatabaseSync } = loadNativeSqliteModule();
  return new DatabaseSync(dbPath, { readOnly: true });
}
function openNativeDbWritable(dbPath) {
  const { DatabaseSync } = loadNativeSqliteModule();
  return new DatabaseSync(dbPath);
}
async function openSqlJsDbReadonly(dbPath) {
  const key = path.resolve(dbPath).toLowerCase();
  const fingerprint = sqliteFileFingerprint(dbPath);
  const cached = cachedSqlJsDbs.get(key);
  if (cached && cached.fingerprint === fingerprint && cached.db) {
    cached.usedAt = Date.now();
    return cached.db;
  }
  const pending = cachedSqlJsOpenPromises.get(key);
  if (pending && pending.fingerprint === fingerprint) return pending.promise;
  if (cached?.db) {
    try { cached.db.close(); } catch {}
    cachedSqlJsDbs.delete(key);
  }
  const promise = (async () => {
    const [SQL, bytes] = await Promise.all([getSqlJs(), fs.promises.readFile(dbPath)]);
    const db = new SQL.Database(bytes);
    cachedSqlJsDbSet.add(db);
    cachedSqlJsDbs.set(key, { db, fingerprint, usedAt: Date.now() });
    pruneSqlJsDbCache();
    return db;
  })();
  cachedSqlJsOpenPromises.set(key, { fingerprint, promise });
  try { return await promise; }
  finally {
    const current = cachedSqlJsOpenPromises.get(key);
    if (current?.promise === promise) cachedSqlJsOpenPromises.delete(key);
  }
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
function closeDb(db) {
  if (!db || typeof db.close !== 'function') return;
  if (cachedSqlJsDbSet.has(db)) return;
  db.close();
}
module.exports = { locateSqlJsFile, loadSqlJsFactory, loadNativeSqliteModule, nativeSqliteStatus, sqliteRuntimeStatus, sqliteFileFingerprint, openNativeDbReadonly, openNativeDbWritable, openSqlJsDbReadonly, nativeAll, nativeAllParams, sqlJsAll, sqlJsAllParams, closeDb };
