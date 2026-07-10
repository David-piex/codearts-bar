'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { rollupCacheDir, rollupCachePath } = require('../../settings');
const { sqliteFileFingerprint } = require('./sqlite');

const ROLLUP_CACHE_SCHEMA_VERSION = 1;
const DEFAULT_KIND = 'usage-rollup';

function safeKind(kind = DEFAULT_KIND) {
  return String(kind || DEFAULT_KIND).replace(/[^a-z0-9._-]+/gi, '-').slice(0, 64) || DEFAULT_KIND;
}

function dbPathHash(dbPath) {
  return crypto.createHash('sha256').update(path.resolve(String(dbPath || ''))).digest('hex');
}

function ensureRollupCacheDir() {
  const dir = rollupCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function clone(value) {
  if (value == null) return value;
  try { return structuredClone(value); } catch {}
  try { return JSON.parse(JSON.stringify(value)); } catch {}
  return value;
}

function buildRollupEnvelope(dbPath, payload, options = {}) {
  const kind = safeKind(options.kind);
  const fingerprint = options.fingerprint || sqliteFileFingerprint(dbPath);
  const shouldClonePayload = options.clonePayload !== false;
  return {
    schemaVersion: ROLLUP_CACHE_SCHEMA_VERSION,
    kind,
    dbPathHash: dbPathHash(dbPath),
    fingerprint,
    generatedAt: Number(options.generatedAt || Date.now()),
    rowCount: Number.isFinite(Number(options.rowCount)) ? Number(options.rowCount) : null,
    payload: shouldClonePayload ? clone(payload) : payload,
  };
}

function validationFailure(reason, target, extra = {}) {
  return { ok: false, reason, path: target, ...extra };
}

function validateRollupEnvelope(envelope, dbPath, options = {}) {
  const target = rollupCachePath(dbPath, options.kind || envelope?.kind || DEFAULT_KIND);
  const expectedKind = safeKind(options.kind || envelope?.kind || DEFAULT_KIND);
  const expectedFingerprint = options.fingerprint || sqliteFileFingerprint(dbPath);
  if (!envelope || typeof envelope !== 'object') return validationFailure('invalid', target);
  if (envelope.schemaVersion !== ROLLUP_CACHE_SCHEMA_VERSION) {
    return validationFailure('schema-mismatch', target, { schemaVersion: envelope.schemaVersion });
  }
  if (envelope.kind !== expectedKind) return validationFailure('kind-mismatch', target, { kind: envelope.kind });
  if (envelope.dbPathHash !== dbPathHash(dbPath)) return validationFailure('db-path-mismatch', target);
  if (envelope.fingerprint !== expectedFingerprint) {
    return validationFailure('fingerprint-mismatch', target, {
      fingerprint: envelope.fingerprint,
      expectedFingerprint,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'payload')) return validationFailure('missing-payload', target);
  const shouldClonePayload = options.clonePayload !== false;
  return {
    ok: true,
    path: target,
    payload: shouldClonePayload ? clone(envelope.payload) : envelope.payload,
    meta: {
      schemaVersion: envelope.schemaVersion,
      kind: envelope.kind,
      dbPathHash: envelope.dbPathHash,
      fingerprint: envelope.fingerprint,
      generatedAt: envelope.generatedAt,
      rowCount: envelope.rowCount,
    },
  };
}

function readRollupCache(dbPath, options = {}) {
  const target = rollupCachePath(dbPath, options.kind || DEFAULT_KIND);
  if (!fs.existsSync(target)) return validationFailure('missing', target);
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return validationFailure('corrupt', target, { error: error && error.message ? error.message : String(error) });
  }
  return validateRollupEnvelope(envelope, dbPath, options);
}

function writeRollupCache(dbPath, payload, options = {}) {
  ensureRollupCacheDir();
  const kind = safeKind(options.kind);
  const target = rollupCachePath(dbPath, kind);
  const envelope = buildRollupEnvelope(dbPath, payload, { ...options, kind, clonePayload: options.clonePayload ?? false });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(envelope), 'utf8');
  fs.renameSync(tmp, target);
  return validateRollupEnvelope(envelope, dbPath, { ...options, kind, clonePayload: options.clonePayload ?? false });
}

function deleteRollupCache(dbPath, options = {}) {
  const target = rollupCachePath(dbPath, options.kind || DEFAULT_KIND);
  try { fs.rmSync(target, { force: true }); } catch {}
  return target;
}

module.exports = {
  ROLLUP_CACHE_SCHEMA_VERSION,
  buildRollupEnvelope,
  validateRollupEnvelope,
  readRollupCache,
  writeRollupCache,
  deleteRollupCache,
  rollupCacheDir,
  rollupCachePath,
};
