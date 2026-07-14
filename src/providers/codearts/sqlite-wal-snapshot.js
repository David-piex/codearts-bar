'use strict';

const fs = require('node:fs');

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');
const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;
const WAL_MAGIC_LITTLE_CHECKSUM = 0x377f0682;
const WAL_MAGIC_BIG_CHECKSUM = 0x377f0683;

function fileFingerprint(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return `${file}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return `${file}:missing`;
  }
}

function sqliteSnapshotFingerprint(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}.touch`].map(fileFingerprint).join('|');
}

function databasePageSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 100 || !bytes.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    const error = new Error('Invalid SQLite database header');
    error.code = 'SQLITE_SNAPSHOT_INVALID_DB';
    throw error;
  }
  const encoded = bytes.readUInt16BE(16);
  const pageSize = encoded === 1 ? 65536 : encoded;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
    const error = new Error(`Invalid SQLite page size: ${pageSize}`);
    error.code = 'SQLITE_SNAPSHOT_INVALID_PAGE_SIZE';
    throw error;
  }
  return pageSize;
}

function walChecksum(bytes, state, littleEndian) {
  let first = state[0] >>> 0;
  let second = state[1] >>> 0;
  for (let offset = 0; offset + 8 <= bytes.length; offset += 8) {
    const a = littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const b = littleEndian ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
    first = (first + a + second) >>> 0;
    second = (second + b + first) >>> 0;
  }
  return [first, second];
}

function invalidWal(message) {
  const error = new Error(message);
  error.code = 'SQLITE_SNAPSHOT_INVALID_WAL';
  return error;
}

function mergeCommittedWal(databaseBytes, walBytes) {
  const pageSize = databasePageSize(databaseBytes);
  if (!Buffer.isBuffer(walBytes) || walBytes.length === 0) {
    return { bytes: Buffer.from(databaseBytes), walAppliedFrames: 0, walCommittedPages: 0 };
  }
  if (walBytes.length < WAL_HEADER_BYTES) throw invalidWal('SQLite WAL header is truncated');
  const magic = walBytes.readUInt32BE(0);
  if (magic !== WAL_MAGIC_LITTLE_CHECKSUM && magic !== WAL_MAGIC_BIG_CHECKSUM) {
    throw invalidWal('SQLite WAL magic is invalid');
  }
  const walPageSizeRaw = walBytes.readUInt32BE(8);
  const walPageSize = walPageSizeRaw === 1 ? 65536 : walPageSizeRaw;
  if (walPageSize !== pageSize) throw invalidWal(`SQLite WAL page size ${walPageSize} does not match database page size ${pageSize}`);

  const littleEndianChecksum = magic === WAL_MAGIC_LITTLE_CHECKSUM;
  let checksum = walChecksum(walBytes.subarray(0, 24), [0, 0], littleEndianChecksum);
  if (checksum[0] !== walBytes.readUInt32BE(24) || checksum[1] !== walBytes.readUInt32BE(28)) {
    throw invalidWal('SQLite WAL header checksum is invalid');
  }

  const salt1 = walBytes.readUInt32BE(16);
  const salt2 = walBytes.readUInt32BE(20);
  const frameBytes = WAL_FRAME_HEADER_BYTES + pageSize;
  const completeFrameCount = Math.floor((walBytes.length - WAL_HEADER_BYTES) / frameBytes);
  const frames = [];
  let lastCommitIndex = -1;
  let committedPages = 0;
  for (let index = 0; index < completeFrameCount; index += 1) {
    const offset = WAL_HEADER_BYTES + index * frameBytes;
    const header = walBytes.subarray(offset, offset + WAL_FRAME_HEADER_BYTES);
    const page = walBytes.subarray(offset + WAL_FRAME_HEADER_BYTES, offset + frameBytes);
    const pageNumber = header.readUInt32BE(0);
    const databasePages = header.readUInt32BE(4);
    if (!pageNumber || header.readUInt32BE(8) !== salt1 || header.readUInt32BE(12) !== salt2) break;
    checksum = walChecksum(header.subarray(0, 8), checksum, littleEndianChecksum);
    checksum = walChecksum(page, checksum, littleEndianChecksum);
    if (checksum[0] !== header.readUInt32BE(16) || checksum[1] !== header.readUInt32BE(20)) break;
    frames.push({ pageNumber, page });
    if (databasePages > 0) {
      lastCommitIndex = frames.length - 1;
      committedPages = databasePages;
    }
  }

  if (lastCommitIndex < 0) {
    return { bytes: Buffer.from(databaseBytes), walAppliedFrames: 0, walCommittedPages: 0 };
  }
  const targetBytes = committedPages * pageSize;
  if (targetBytes < 100) throw invalidWal('SQLite WAL commit has an invalid database size');
  const merged = Buffer.alloc(targetBytes);
  databaseBytes.copy(merged, 0, 0, Math.min(databaseBytes.length, merged.length));
  let applied = 0;
  for (let index = 0; index <= lastCommitIndex; index += 1) {
    const frame = frames[index];
    if (frame.pageNumber > committedPages) continue;
    frame.page.copy(merged, (frame.pageNumber - 1) * pageSize);
    applied += 1;
  }
  return { bytes: merged, walAppliedFrames: applied, walCommittedPages: committedPages };
}

async function readOptionalFile(file) {
  try { return await fs.promises.readFile(file); }
  catch (error) {
    if (error?.code === 'ENOENT') return Buffer.alloc(0);
    throw error;
  }
}

async function readSqliteSnapshot(dbPath, options = {}) {
  const attempts = Math.max(1, Math.min(5, Number(options.attempts || 3) || 3));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const before = sqliteSnapshotFingerprint(dbPath);
    const [databaseBytes, walBytes] = await Promise.all([
      fs.promises.readFile(dbPath),
      readOptionalFile(`${dbPath}-wal`),
    ]);
    const after = sqliteSnapshotFingerprint(dbPath);
    if (before === after) return { ...mergeCommittedWal(databaseBytes, walBytes), fingerprint: after };
    await new Promise((resolve) => setImmediate(resolve));
  }
  const error = new Error('SQLite database changed while creating a read-only snapshot');
  error.code = 'SQLITE_SNAPSHOT_BUSY';
  throw error;
}

module.exports = {
  databasePageSize,
  walChecksum,
  mergeCommittedWal,
  sqliteSnapshotFingerprint,
  readSqliteSnapshot,
};
