'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
function openNativeDbReadonly(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true });
}
function openNativeDbWritable(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(dbPath);
}
async function openSqlJsDbReadonly(dbPath) {
  const initSqlJs = loadSqlJsFactory();
  const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
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
module.exports = { locateSqlJsFile, loadSqlJsFactory, openNativeDbReadonly, openNativeDbWritable, openSqlJsDbReadonly, nativeAll, nativeAllParams, sqlJsAll, sqlJsAllParams, closeDb };
