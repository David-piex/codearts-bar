'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readSqliteSnapshot, sqliteSnapshotFingerprint } = require('./sqlite-wal-snapshot');

let nativeSqliteModule = null;
let nativeSqliteError = null;
let sqlJsReadyPromise = null;
const cachedSqlJsDbs = new Map();
const cachedSqlJsOpenPromises = new Map();
const cachedSqlJsDbSet = new WeakSet();
const sqlJsReadOnlyRaw = new WeakMap();
const SQLJS_DB_CACHE_LIMIT = 3;

function assertSqlJsReadOnly(sql = '') {
  const normalized = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ').trim().replace(/^;+/, '').trim();
  const singleStatement = normalized.replace(/;+\s*$/, '').trim();
  if (singleStatement.includes(';')) throw Object.assign(new Error('sql.js readonly adapter rejects multiple SQL statements'), { code: 'SQLJS_READONLY' });
  const first = singleStatement.match(/^([a-z]+)/i)?.[1]?.toLowerCase() || '';
  const pragma = singleStatement.match(/^pragma\s+([a-z_]+)/i)?.[1]?.toLowerCase() || '';
  const allowedPragmas = new Set(['quick_check', 'integrity_check', 'table_info', 'index_info', 'index_list', 'schema_version', 'user_version']);
  if (first === 'pragma' && allowedPragmas.has(pragma) && !/\s*=/.test(singleStatement)) return singleStatement;
  if (['select', 'with', 'explain'].includes(first) && !/\b(insert|update|delete|replace|create|drop|alter|vacuum|reindex|attach|detach|begin|commit|rollback|savepoint|release)\b/i.test(singleStatement)) return singleStatement;
  throw Object.assign(new Error('sql.js readonly adapter rejects non-query SQL'), { code: 'SQLJS_READONLY' });
}

function makeSqlJsReadonlyFacade(raw) {
  const facade = {
    prepare(sql) { return raw.prepare(assertSqlJsReadOnly(sql)); },
    exec(sql) { assertSqlJsReadOnly(sql); return raw.exec(sql); },
    export() { throw Object.assign(new Error('sql.js readonly adapter does not expose database export'), { code: 'SQLJS_READONLY' }); },
  };
  sqlJsReadOnlyRaw.set(facade, raw);
  cachedSqlJsDbSet.add(facade);
  return facade;
}

function locateSqlJsFile(file) {
  const candidates = [
    // Packaged desktop runtime: src/providers/codearts -> src/vendor/sql.js.
    path.join(__dirname, '..', '..', 'vendor', 'sql.js', file),
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
  catch { return require(locateSqlJsFile('sql-wasm.js')); }
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
      databaseSync: Boolean(mod && mod.DatabaseSync),
      experimental: true,
    };
  } catch (error) {
    return {
      available: false,
      adapter: 'sql.js',
      node: process.version,
      error: 'node:sqlite unavailable',
    };
  }
}
function sqliteRuntimeStatus() {
  const native = nativeSqliteStatus();
  return {
    preferred: native.available ? 'node:sqlite' : 'sql.js',
    native,
    fallback: { adapter: 'sql.js', available: true, wasm: 'sql-wasm.wasm' },
  };
}
async function getSqlJs() {
  if (!sqlJsReadyPromise) {
    const initSqlJs = loadSqlJsFactory();
    sqlJsReadyPromise = Promise.resolve(initSqlJs({ locateFile: locateSqlJsFile }));
  }
  return sqlJsReadyPromise;
}
function sqliteFileFingerprint(dbPath) {
  return sqliteSnapshotFingerprint(dbPath);
}
function pruneSqlJsDbCache() {
  if (cachedSqlJsDbs.size <= SQLJS_DB_CACHE_LIMIT) return;
  const entries = [...cachedSqlJsDbs.entries()].sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
  for (const [key, entry] of entries.slice(0, Math.max(0, entries.length - SQLJS_DB_CACHE_LIMIT))) {
    try { (entry.raw || sqlJsReadOnlyRaw.get(entry.db) || entry.db)?.close?.(); } catch {}
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
    try { (cached.raw || sqlJsReadOnlyRaw.get(cached.db) || cached.db).close(); } catch {}
    cachedSqlJsDbs.delete(key);
  }
  const promise = (async () => {
    const [SQL, snapshot] = await Promise.all([getSqlJs(), readSqliteSnapshot(dbPath)]);
    const raw = new SQL.Database(snapshot.bytes);
    const db = makeSqlJsReadonlyFacade(raw);
    cachedSqlJsDbs.set(key, { db, raw, fingerprint: snapshot.fingerprint, usedAt: Date.now() });
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
