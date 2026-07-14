'use strict';

const { sqliteFileFingerprint } = require('./sqlite');

const CACHE_LIMIT = Math.max(8, Math.min(256, Number(process.env.CODEARTS_BAR_AGGREGATE_CACHE_LIMIT || 64) || 64));
const DEFAULT_TTL_MS = Math.max(1000, Math.min(10 * 60 * 1000, Number(process.env.CODEARTS_BAR_AGGREGATE_CACHE_TTL_MS || 120000) || 120000));
const DEFAULT_TIME_BUCKET_MS = Math.max(1000, Math.min(60 * 60 * 1000, Number(process.env.CODEARTS_BAR_AGGREGATE_CACHE_TIME_BUCKET_MS || 60000) || 60000));
const cache = new Map();
let hits = 0;
let misses = 0;

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (key === 'slowAggregateMs' || key === 'disableAggregateCache' || key === 'noAggregateCache') return out;
    out[key] = stableObject(value[key]);
    return out;
  }, {});
}

function clone(value) {
  if (value == null) return value;
  try { return structuredClone(value); } catch {}
  try { return JSON.parse(JSON.stringify(value)); } catch {}
  return value;
}

function normalizeTimestamp(timestamp, bucketMs = DEFAULT_TIME_BUCKET_MS) {
  const ts = Number(timestamp || 0);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return Math.floor(ts / bucketMs) * bucketMs;
}
function effectiveBucketOffsetMs(payload = {}) {
  const explicit = Number(payload.bucketOffsetMs);
  if (Number.isFinite(explicit)) return explicit;
  const range = payload.range || {};
  const start = Number(payload.start ?? range.start ?? 0);
  const end = Number(payload.endExclusive ?? payload.end ?? range.endExclusive ?? range.end ?? payload.timestamp ?? Date.now());
  const reference = start > 0 && end > start ? start + (end - start) / 2 : end;
  return -new Date(reference).getTimezoneOffset() * 60 * 1000;
}

function sourceFingerprints(sources = []) {
  return sources.map((source) => ({
    id: source.id,
    dbPath: source.dbPath,
    fingerprint: sqliteFileFingerprint(source.dbPath),
  }));
}

function aggregateCacheKey(label, adapter, payload = {}, sources = []) {
  if (payload.disableAggregateCache || payload.noAggregateCache) return '';
  if (label === 'databaseHealth') return '';
  const timeBucketMs = Number(payload.aggregateCacheTimeBucketMs || DEFAULT_TIME_BUCKET_MS) || DEFAULT_TIME_BUCKET_MS;
  const normalized = stableObject({
    source: payload.source || 'all',
    model: payload.model || 'all',
    query: payload.query || '',
    sessionId: payload.sessionId || '',
    status: payload.status || '',
    project: payload.project || '',
    bucket: payload.bucket || '',
    bucketMs: payload.bucketMs || 0,
    bucketOffsetMs: effectiveBucketOffsetMs(payload),
    windowHours: payload.windowHours || 24,
    range: payload.range || {},
    start: payload.start || 0,
    end: payload.end || 0,
    timestamp: normalizeTimestamp(payload.timestamp, timeBucketMs),
  });
  return JSON.stringify({ label, adapter, payload: normalized, sources: sourceFingerprints(sources) });
}

function prune(now = Date.now()) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size <= CACHE_LIMIT) return;
  const entries = [...cache.entries()].sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
  for (const [key] of entries.slice(0, Math.max(0, entries.length - CACHE_LIMIT))) cache.delete(key);
}

function getAggregateCache(key) {
  if (!key) return null;
  const now = Date.now();
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) cache.delete(key);
    misses += 1;
    return null;
  }
  entry.usedAt = now;
  hits += 1;
  return clone(entry.value);
}

function setAggregateCache(key, value, payload = {}) {
  if (!key || !value || typeof value !== 'object' || value.ok !== true) return value;
  const now = Date.now();
  const ttl = Math.max(1000, Math.min(10 * 60 * 1000, Number(payload.aggregateCacheTtlMs || DEFAULT_TTL_MS) || DEFAULT_TTL_MS));
  cache.set(key, { value: clone(value), createdAt: now, usedAt: now, expiresAt: now + ttl });
  prune(now);
  return value;
}

function annotateCacheHit(result, hit = false) {
  if (result && typeof result === 'object') {
    result.perf = { ...(result.perf || {}), aggregateCache: { hit: Boolean(hit), hits, misses, size: cache.size } };
  }
  return result;
}

function aggregateCacheStats() {
  const reads = hits + misses;
  return { hits, misses, reads, hitRate: reads > 0 ? hits / reads : null, size: cache.size, limit: CACHE_LIMIT, ttlMs: DEFAULT_TTL_MS, timeBucketMs: DEFAULT_TIME_BUCKET_MS };
}

function clearAggregateCache() {
  cache.clear();
  hits = 0;
  misses = 0;
}

module.exports = {
  aggregateCacheKey,
  getAggregateCache,
  setAggregateCache,
  annotateCacheHit,
  aggregateCacheStats,
  clearAggregateCache,
};
