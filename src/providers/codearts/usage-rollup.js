'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const nativeSql = require('./aggregation-sql');
const { readRollupCache, writeRollupCache } = require('./rollup-cache');
const { recordBestEffortFailure } = require('../../core/best-effort');
const { validateTables } = require('./sources');
const {
  openNativeDbReadonly,
  openSqlJsDbReadonly,
  nativeAll,
  nativeAllParams,
  sqlJsAll,
  sqlJsAllParams,
  closeDb,
} = require('./sqlite');

const {
  toNumber,
  normalizeTokenRows,
  normalizeSessionRows,
  normalizeCompactRows,
  buildCompactUsageRollup,
  compactRollupIsSafeForDashboard,
  sessionSummaryPartFromRollup,
  dashboardPartFromCompactRollup,
  dashboardPartFromUsageRollup,
} = require('./usage-rollup-calc');

const MESSAGE_TOKEN_CACHE_KIND = 'message-token-cache-v1';
const COMPACT_USAGE_ROLLUP_KIND = 'usage-compact-hourly-v1';
const SESSION_SUMMARY_ROLLUP_KIND = 'session-summary-v1';
const HOUR_MS = 60 * 60 * 1000;
const pendingBuilds = new Map();
const rollupStats = {
  compactHits: 0,
  sessionHits: 0,
  tokenHits: 0,
  misses: 0,
  invalid: 0,
  rebuilt: 0,
  writeFailures: 0,
  scheduled: 0,
  skippedPending: 0,
  skippedDisabled: 0,
  buildCompleted: 0,
  buildFailed: 0,
  buildRuns: 0,
  incrementalBuilds: 0,
  incrementalRows: 0,
  buildMsTotal: 0,
  buildMsMax: 0,
};
const recentBuilds = [];

function hashPath(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function pendingBuildEntry(source = {}, options = {}) {
  const dbPath = source.dbPath || '';
  return {
    sourceId: source.id || 'unknown',
    sourceLabel: source.label || source.id || 'unknown',
    adapter: options.adapter || 'node:sqlite',
    kind: options.kind || MESSAGE_TOKEN_CACHE_KIND,
    dbHash: hashPath(dbPath),
    dbName: dbPath ? path.basename(dbPath) : '',
    startedAt: Date.now(),
  };
}

function nowMs() {
  try { if (globalThis.performance && typeof globalThis.performance.now === 'function') return globalThis.performance.now(); }
  catch {}
  return Date.now();
}

function sanitizedBuildError(error) {
  const message = error && error.message ? error.message : String(error || '');
  if (!message) return '';
  return message
    .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '[path]')
    .replace(/\/(?:[^/\s'"]+\/)+[^/\s'"]+/g, '[path]')
    .slice(0, 240);
}

function recordRollupBuild(source = {}, options = {}, result = null, durationMs = 0, error = null) {
  const dbPath = source.dbPath || '';
  const status = error ? 'failed' : (result?.usageRollup?.status || 'completed');
  const entry = {
    sourceId: source.id || 'unknown',
    sourceLabel: source.label || source.id || 'unknown',
    adapter: options.adapter || 'node:sqlite',
    kind: options.kind || MESSAGE_TOKEN_CACHE_KIND,
    dbHash: hashPath(dbPath),
    dbName: dbPath ? path.basename(dbPath) : '',
    status,
    durationMs: Number(Number(durationMs || 0).toFixed(1)),
    rowCount: result?.usageRollup?.rowCount ?? result?.rows?.length ?? null,
    compactBuckets: result?.usageRollup?.compact?.compactBuckets ?? result?.usageRollup?.compactBuckets ?? null,
    completedAt: Date.now(),
  };
  if (error) entry.error = sanitizedBuildError(error);
  rollupStats.buildRuns += 1;
  rollupStats.buildMsTotal += entry.durationMs;
  rollupStats.buildMsMax = Math.max(rollupStats.buildMsMax, entry.durationMs);
  recentBuilds.unshift(entry);
  recentBuilds.splice(8);
  return entry;
}

function recordRollupRead(result) {
  if (result?.ok) return;
  const reason = result?.reason || 'invalid';
  if (reason === 'missing' || reason === 'fingerprint-mismatch') rollupStats.misses += 1;
  else rollupStats.invalid += 1;
}

function canUseUsageRollup(payload = {}) {
  if (process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP === '1') return false;
  if (payload.disableUsageRollup || payload.noUsageRollup) return false;
  if (payload.query || payload.sessionId) return false;
  if (payload.model && payload.model !== 'all') return false;
  return true;
}

function canUseSessionSummaryRollup(payload = {}) {
  if (process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP === '1') return false;
  if (payload.disableUsageRollup || payload.noUsageRollup) return false;
  if (payload.query || payload.sessionId) return false;
  return true;
}

function buildUsageRollupForSource(args, payload = {}) {
  const rows = normalizeTokenRows(nativeSql.messageTokenRowsForSourceSql({ ...args, payload }));
  return {
    source: { id: args.source.id, label: args.source.label, dbPath: args.source.dbPath },
    rows,
  };
}

function buildSessionSummaryRollupForSource(args) {
  const sessions = normalizeSessionRows(nativeSql.sessionRowsForSourceSql(args));
  return {
    source: { id: args.source.id, label: args.source.label, dbPath: args.source.dbPath },
    sessions,
    rowCount: sessions.length,
  };
}

function readUsageRollupForSource(source, options = {}) {
  const kind = options.kind || MESSAGE_TOKEN_CACHE_KIND;
  const cached = readRollupCache(source.dbPath, { kind, clonePayload: false, allowFingerprintMismatch: options.allowStale === true });
  if (!cached.ok || !Array.isArray(cached.payload?.rows)) {
    recordRollupRead(cached);
    return {
      ok: false,
      reason: cached.reason || 'invalid',
      path: cached.path,
    };
  }
  rollupStats.tokenHits += 1;
  return {
    ok: true,
    ...cached.payload,
    source: cached.payload.source || { id: source.id, label: source.label, dbPath: source.dbPath },
    rows: normalizeTokenRows(cached.payload.rows),
    usageRollup: {
      status: 'hit',
      path: cached.path,
      generatedAt: cached.meta?.generatedAt || null,
      stale: Boolean(cached.meta?.stale),
      rowCount: cached.meta?.rowCount ?? cached.payload.rows.length,
    },
  };
}

function readCompactUsageRollupForSource(source, options = {}) {
  const kind = options.kind || COMPACT_USAGE_ROLLUP_KIND;
  const cached = readRollupCache(source.dbPath, { kind, clonePayload: false });
  if (!cached.ok || !Array.isArray(cached.payload?.hourly)) {
    recordRollupRead(cached);
    return {
      ok: false,
      reason: cached.reason || 'invalid',
      path: cached.path,
    };
  }
  rollupStats.compactHits += 1;
  return {
    ok: true,
    ...cached.payload,
    source: cached.payload.source || { id: source.id, label: source.label, dbPath: source.dbPath },
    bucketMs: Math.max(60000, toNumber(cached.payload.bucketMs, HOUR_MS)),
    hourly: normalizeCompactRows(cached.payload.hourly),
    hourlyModels: normalizeCompactRows(cached.payload.hourlyModels || []),
    usageRollup: {
      status: 'compact-hit',
      path: cached.path,
      generatedAt: cached.meta?.generatedAt || null,
      rowCount: cached.meta?.rowCount ?? cached.payload.rowCount ?? null,
      compactBuckets: cached.payload.hourly.length,
    },
  };
}

function readSessionSummaryRollupForSource(source, options = {}) {
  const kind = options.kind || SESSION_SUMMARY_ROLLUP_KIND;
  const cached = readRollupCache(source.dbPath, { kind, clonePayload: false });
  if (!cached.ok || !Array.isArray(cached.payload?.sessions)) {
    recordRollupRead(cached);
    return {
      ok: false,
      reason: cached.reason || 'invalid',
      path: cached.path,
    };
  }
  rollupStats.sessionHits += 1;
  return {
    ok: true,
    ...cached.payload,
    source: cached.payload.source || { id: source.id, label: source.label, dbPath: source.dbPath },
    sessions: normalizeSessionRows(cached.payload.sessions),
    usageRollup: {
      status: 'session-hit',
      path: cached.path,
      generatedAt: cached.meta?.generatedAt || null,
      rowCount: cached.meta?.rowCount ?? cached.payload.rowCount ?? cached.payload.sessions.length,
    },
  };
}

function writeCompactUsageRollup(source, rows, options = {}) {
  const compact = buildCompactUsageRollup(source, rows, options.bucketMs || HOUR_MS);
  const written = writeRollupCache(source.dbPath, compact, {
    kind: options.kind || COMPACT_USAGE_ROLLUP_KIND,
    rowCount: compact.rowCount,
  });
  return {
    ...compact,
    usageRollup: {
      status: 'compact-built',
      path: written.path,
      generatedAt: written.meta?.generatedAt || null,
      rowCount: compact.rowCount,
      compactBuckets: compact.hourly.length,
    },
  };
}

function writeSessionSummaryRollup(source, sessions, options = {}) {
  const payload = {
    source: { id: source.id, label: source.label, dbPath: source.dbPath },
    sessions: normalizeSessionRows(sessions),
  };
  payload.rowCount = payload.sessions.length;
  const written = writeRollupCache(source.dbPath, payload, {
    kind: options.kind || SESSION_SUMMARY_ROLLUP_KIND,
    rowCount: payload.rowCount,
  });
  return {
    ...payload,
    usageRollup: {
      status: 'session-built',
      path: written.path,
      generatedAt: written.meta?.generatedAt || null,
      rowCount: payload.rowCount,
    },
  };
}

function readOrBuildSessionSummaryRollup(args, options = {}) {
  const kind = options.kind || SESSION_SUMMARY_ROLLUP_KIND;
  const cached = readSessionSummaryRollupForSource(args.source, { kind });
  if (cached.ok) return cached;
  const built = buildSessionSummaryRollupForSource(args);
  try {
    const written = writeSessionSummaryRollup(args.source, built.sessions, { kind });
    return {
      ...built,
      usageRollup: {
        status: cached.reason === 'missing' ? 'session-miss' : 'session-rebuilt',
        previousReason: cached.reason || null,
        path: written.usageRollup.path,
        generatedAt: written.usageRollup.generatedAt || null,
        rowCount: built.sessions.length,
      },
    };
  } catch (error) {
    rollupStats.writeFailures += 1;
    return {
      ...built,
      usageRollup: {
        status: 'session-write-failed',
        previousReason: cached.reason || null,
        error: error && error.message ? error.message : String(error),
        rowCount: built.sessions.length,
      },
    };
  }
}

function readOrBuildUsageRollup(args, options = {}) {
  const kind = options.kind || MESSAGE_TOKEN_CACHE_KIND;
  const cached = readUsageRollupForSource(args.source, { kind });
  if (cached.ok) {
    const compact = readCompactUsageRollupForSource(args.source);
    if (!compact.ok) {
      try { writeCompactUsageRollup(args.source, cached.rows); } catch (error) { recordBestEffortFailure('rollup.compact-refresh', error, { sourceId: args.source.id }); }
    }
    return cached;
  }
  const stale = readUsageRollupForSource(args.source, { kind, allowStale: true });
  let built;
  let incremental = false;
  if (stale.ok && stale.usageRollup?.stale && stale.rows.length) {
    // Cursor on update time catches edits to old messages; the overlap tolerates coarse
    // timestamps and transactions that become visible around the cache boundary.
    const maxUpdatedTime = stale.rows.reduce((max, row) => Math.max(
      max,
      Number(row.timeUpdated || row.timeCreated || 0),
    ), 0);
    const updatedSince = Math.max(0, maxUpdatedTime - HOUR_MS);
    const changed = buildUsageRollupForSource(args, { updatedSince }).rows;
    const merged = new Map(stale.rows.map((row) => [row.id, row]));
    for (const row of changed) merged.set(row.id, row);
    built = { source: stale.source, rows: [...merged.values()].sort((a, b) => Number(a.timeCreated || 0) - Number(b.timeCreated || 0)) };
    incremental = true;
    rollupStats.incrementalBuilds += 1;
    rollupStats.incrementalRows += changed.length;
  } else {
    built = buildUsageRollupForSource(args);
  }
  try {
    const written = writeRollupCache(args.source.dbPath, built, {
      kind,
      rowCount: built.rows.length,
    });
    let compactMeta = null;
    try { compactMeta = writeCompactUsageRollup(args.source, built.rows).usageRollup; } catch (error) { recordBestEffortFailure('rollup.compact-write', error, { sourceId: args.source.id }); }
    rollupStats.rebuilt += 1;
    return {
      ...built,
      usageRollup: {
        status: incremental ? 'incremental-rebuilt' : (cached.reason === 'missing' ? 'miss' : 'rebuilt'),
        incremental,
        incrementalCursor: incremental ? 'timeUpdated' : null,
        previousReason: cached.reason || null,
        path: written.path,
        generatedAt: written.meta?.generatedAt || null,
        rowCount: built.rows.length,
        compact: compactMeta,
      },
    };
  } catch (error) {
    rollupStats.writeFailures += 1;
    return {
      ...built,
      usageRollup: {
        status: 'write-failed',
        previousReason: cached.reason || null,
        error: error && error.message ? error.message : String(error),
        rowCount: built.rows.length,
      },
    };
  }
}

async function buildAndWriteUsageRollupForSource(source, options = {}) {
  const adapter = options.adapter || 'node:sqlite';
  const kind = options.kind || MESSAGE_TOKEN_CACHE_KIND;
  let db;
  const started = nowMs();
  try {
    let result;
    if (adapter === 'sql.js') {
      db = await openSqlJsDbReadonly(source.dbPath);
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      result = readOrBuildUsageRollup({ source, db, tables, queryAll: sqlJsAllParams }, { kind });
      try { result.usageRollup.session = readOrBuildSessionSummaryRollup({ source, db, tables, queryAll: sqlJsAllParams }).usageRollup; } catch (error) { recordBestEffortFailure('rollup.session-sqljs', error, { sourceId: source.id }); }
      recordRollupBuild(source, { ...options, adapter, kind }, result, nowMs() - started, null);
      return result;
    }
    db = openNativeDbReadonly(source.dbPath);
    const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
    validateTables(tables);
    result = readOrBuildUsageRollup({ source, db, tables, queryAll: nativeAllParams }, { kind });
    try { result.usageRollup.session = readOrBuildSessionSummaryRollup({ source, db, tables, queryAll: nativeAllParams }).usageRollup; } catch (error) { recordBestEffortFailure('rollup.session-native', error, { sourceId: source.id }); }
    recordRollupBuild(source, { ...options, adapter, kind }, result, nowMs() - started, null);
    return result;
  } catch (error) {
    recordRollupBuild(source, { ...options, adapter, kind }, null, nowMs() - started, error);
    throw error;
  } finally {
    closeDb(db);
  }
}

function scheduleUsageRollupBuild(source, options = {}) {
  if (process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD === '1') {
    rollupStats.skippedDisabled += 1;
    return { scheduled: false, reason: 'disabled' };
  }
  const adapter = options.adapter || 'node:sqlite';
  const key = `${adapter}:${source.dbPath}:${options.kind || MESSAGE_TOKEN_CACHE_KIND}`;
  if (pendingBuilds.has(key)) {
    rollupStats.skippedPending += 1;
    return { scheduled: false, reason: 'pending' };
  }
  const entry = pendingBuildEntry(source, { ...options, adapter });
  const timer = setTimeout(() => {
    buildAndWriteUsageRollupForSource(source, options)
      .then(() => {
        rollupStats.buildCompleted += 1;
      })
      .catch((error) => {
        rollupStats.buildFailed += 1;
        if (process.env.CODEARTS_BAR_DEBUG_ROLLUP === '1') {
          console.warn(`[codearts-bar] usage rollup build failed for ${source.id}: ${error.message}`);
        }
      })
      .finally(() => pendingBuilds.delete(key));
  }, Math.max(0, Number(options.delayMs || 0)));
  pendingBuilds.set(key, { ...entry, timer });
  rollupStats.scheduled += 1;
  return { scheduled: true };
}

function usageRollupStats() {
  const now = Date.now();
  const pending = [...pendingBuilds.values()].map(({ timer, ...entry }) => ({
    ...entry,
    ageMs: Math.max(0, now - Number(entry.startedAt || now)),
  }));
  const reads = rollupStats.compactHits + rollupStats.tokenHits + rollupStats.misses + rollupStats.invalid;
  const buildAverageMs = rollupStats.buildRuns > 0 ? rollupStats.buildMsTotal / rollupStats.buildRuns : null;
  const lastBuild = recentBuilds[0] || null;
  return {
    ...rollupStats,
    enabled: process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP !== '1',
    buildEnabled: process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD !== '1',
    pendingCount: pending.length,
    pending,
    lastBuild,
    recentBuilds: recentBuilds.slice(0, 5),
    buildAverageMs,
    lastBuildMs: lastBuild ? lastBuild.durationMs : null,
    reads,
    hitRate: reads > 0 ? (rollupStats.compactHits + rollupStats.tokenHits) / reads : null,
  };
}

function resetUsageRollupStats() {
  for (const entry of pendingBuilds.values()) {
    if (entry?.timer) clearTimeout(entry.timer);
  }
  pendingBuilds.clear();
  for (const key of Object.keys(rollupStats)) rollupStats[key] = 0;
  recentBuilds.length = 0;
}

module.exports = {
  MESSAGE_TOKEN_CACHE_KIND,
  COMPACT_USAGE_ROLLUP_KIND,
  SESSION_SUMMARY_ROLLUP_KIND,
  canUseUsageRollup,
  canUseSessionSummaryRollup,
  compactRollupIsSafeForDashboard,
  readCompactUsageRollupForSource,
  readUsageRollupForSource,
  readSessionSummaryRollupForSource,
  readOrBuildUsageRollup,
  readOrBuildSessionSummaryRollup,
  buildAndWriteUsageRollupForSource,
  scheduleUsageRollupBuild,
  usageRollupStats,
  resetUsageRollupStats,
  sessionSummaryPartFromRollup,
  dashboardPartFromCompactRollup,
  dashboardPartFromUsageRollup,
};
