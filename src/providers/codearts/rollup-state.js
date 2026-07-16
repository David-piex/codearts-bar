'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { rollupCacheDir } = require('../../settings');
const { writeJsonAtomic, readJsonSafe } = require('../../core/atomic-file');
const { safeDbError } = require('./diagnostics');

const STATE_SCHEMA_VERSION = 1;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATES = new Set(['queued', 'running', 'retrying']);

function sourceHash(dbPath = '') {
  return crypto.createHash('sha256').update(path.resolve(String(dbPath || ''))).digest('hex').slice(0, 24);
}

function statePath(dbPath = '') {
  return path.join(rollupCacheDir(), `${sourceHash(dbPath)}.build-state.json`);
}

function sanitizeState(state = {}) {
  const now = Date.now();
  const status = String(state.status || 'idle');
  const phase = String(state.phase || 'idle');
  const percent = Math.max(0, Math.min(100, Number(state.percent || 0)));
  const scannedRows = Math.max(0, Math.trunc(Number(state.scannedRows || 0)));
  const totalRows = Math.max(scannedRows, Math.trunc(Number(state.totalRows || 0)));
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    sourceId: String(state.sourceId || 'unknown'),
    sourceLabel: String(state.sourceLabel || state.sourceId || 'unknown'),
    sourceHash: String(state.sourceHash || ''),
    adapter: String(state.adapter || 'node:sqlite'),
    status,
    phase,
    percent,
    scannedRows,
    totalRows,
    attempt: Math.max(1, Math.trunc(Number(state.attempt || 1))),
    fallback: state.fallback === 'direct-sql' ? 'direct-sql' : null,
    startedAt: Math.max(0, Number(state.startedAt || 0)),
    updatedAt: Math.max(0, Number(state.updatedAt || now)),
    completedAt: Math.max(0, Number(state.completedAt || 0)),
    nextRetryAt: Math.max(0, Number(state.nextRetryAt || 0)),
    error: state.error ? safeDbError(state.error) : '',
  };
}

function writeRollupState(source = {}, patch = {}) {
  const dbPath = source.dbPath || '';
  if (!dbPath) return null;
  const previous = readJsonSafe(statePath(dbPath), {}) || {};
  const next = sanitizeState({
    ...previous,
    ...patch,
    sourceId: source.id || previous.sourceId,
    sourceLabel: source.label || previous.sourceLabel,
    sourceHash: sourceHash(dbPath),
    updatedAt: Date.now(),
  });
  writeJsonAtomic(statePath(dbPath), next, { compact: true, newline: false, fsync: false });
  return next;
}

function readRollupState(source = {}, options = {}) {
  const dbPath = source.dbPath || '';
  if (!dbPath) return null;
  const raw = readJsonSafe(statePath(dbPath), null);
  if (!raw || Number(raw.schemaVersion) !== STATE_SCHEMA_VERSION) return null;
  const state = sanitizeState(raw);
  const ageMs = Math.max(0, Date.now() - Number(state.updatedAt || 0));
  if (ageMs > Number(options.ttlMs || STATE_TTL_MS)) return null;
  if (ACTIVE_STATES.has(state.status) && ageMs > Number(options.activeStaleMs || 5 * 60 * 1000)) {
    return sanitizeState({ ...state, status: 'failed', phase: 'stale', error: '后台构建意外中断', nextRetryAt: 0 });
  }
  return state;
}

function removeRollupState(source = {}) {
  try { fs.rmSync(statePath(source.dbPath || ''), { force: true }); } catch {}
}

function aggregateRollupState(sources = []) {
  const items = (sources || []).map((source) => readRollupState(source)).filter(Boolean);
  if (!items.length) return { status: 'idle', phase: 'idle', percent: 100, scannedRows: 0, totalRows: 0, sources: [] };
  const rank = { failed: 5, retrying: 4, running: 3, queued: 2, ready: 1, idle: 0 };
  const primary = items.slice().sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0))[0];
  const totalRows = items.reduce((sum, item) => sum + Number(item.totalRows || 0), 0);
  const scannedRows = items.reduce((sum, item) => sum + Number(item.scannedRows || 0), 0);
  return {
    status: primary.status,
    phase: primary.phase,
    percent: totalRows > 0 ? Math.min(100, Math.round((scannedRows / totalRows) * 100)) : Number(primary.percent || 0),
    scannedRows,
    totalRows,
    fallback: items.some((item) => item.fallback === 'direct-sql') ? 'direct-sql' : null,
    attempt: Math.max(...items.map((item) => Number(item.attempt || 1))),
    nextRetryAt: Math.max(...items.map((item) => Number(item.nextRetryAt || 0))),
    error: primary.error || '',
    updatedAt: Math.max(...items.map((item) => Number(item.updatedAt || 0))),
    sources: items,
  };
}

module.exports = {
  ACTIVE_STATES,
  aggregateRollupState,
  readRollupState,
  removeRollupState,
  sanitizeState,
  sourceHash,
  statePath,
  writeRollupState,
};
