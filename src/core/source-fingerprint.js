'use strict';

const path = require('node:path');

function statFingerprint(fs, file) {
  try {
    const stat = fs.statSync(file);
    return `${path.resolve(file).toLowerCase()}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return `${path.resolve(file).toLowerCase()}:missing`;
  }
}

function databaseFingerprint(fs, sources = []) {
  return sources.map((source) => [source.dbPath, `${source.dbPath}-wal`, `${source.dbPath}-shm`, `${source.dbPath}.touch`]
    .map((file) => statFingerprint(fs, file)).join('|')).join('||');
}

module.exports = { statFingerprint, databaseFingerprint };
