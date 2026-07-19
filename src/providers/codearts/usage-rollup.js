'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isMainThread } = require('node:worker_threads');
const nativeSql = require('./aggregation-sql');
const { readRollupCache, writeRollupCache } = require('./rollup-cache');
const { recordBestEffortFailure } = require('../../core/best-effort');
const { assistantWhere, validateTables, tableColumnNames, filterValues } = require('./sources');
const { safeDbError } = require('./diagnostics');
const {
  aggregateRollupState,
  writeRollupState,
} = require('./rollup-state');
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
  sessionSummaryPartFromScopedRollups,
  dashboardPartFromCompactRollup,
  dashboardPartFromUsageRollup,
} = require('./usage-rollup-calc');

// The row eligibility and latency schema changed; old caches must not be mixed
// with the current analytics contract.
const MESSAGE_TOKEN_CACHE_KIND = 'message-token-cache-v2';
const COMPACT_USAGE_ROLLUP_KIND = 'usage-compact-hourly-v2';
const SESSION_SUMMARY_ROLLUP_KIND = 'session-summary-v4';
const HOUR_MS = 60 * 60 * 1000;
const pendingBuilds = new Map();
let buildListener = null;
let stateListener = null;
let rollupStatsGeneration = 0;
const normalizedPayloads = new WeakMap();
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
  buildRetries: 0,
  buildRecovered: 0,
  buildRuns: 0,
  incrementalBuilds: 0,
  incrementalRows: 0,
  incrementalDeletedRows: 0,
  buildMsTotal: 0,
  buildMsMax: 0,
};

function normalizedRows(payload, key, rows, normalize) {
  if (!payload || typeof payload !== 'object') return normalize(rows);
  let cached = normalizedPayloads.get(payload);
  if (!cached) { cached = {}; normalizedPayloads.set(payload, cached); }
  if (!cached[key]) cached[key] = normalize(rows);
  return cached[key];
}
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
    status: Number(options.attempt || 1) > 1 ? 'retrying' : 'queued',
    phase: 'queued',
    percent: 0,
    scannedRows: 0,
    totalRows: 0,
    attempt: Math.max(1, Number(options.attempt || 1)),
    fallback: options.fallback === 'direct-sql' ? 'direct-sql' : null,
  };
}

function publishRollupState(source, patch = {}) {
  let state = null;
  try { state = writeRollupState(source, patch); }
  catch (error) { recordBestEffortFailure('rollup.state-write', error, { sourceId: source.id }); }
  if (state && isMainThread && stateListener) {
    try { stateListener(state); }
    catch (error) { recordBestEffortFailure('rollup.state-listener', error, { sourceId: source.id }); }
  }
  return state;
}

function progressReporter(source, options = {}) {
  const startedAt = Number(options.startedAt || Date.now());
  return (progress = {}) => {
    if (!isCurrentStatsGeneration(options)) return null;
    return publishRollupState(source, {
      adapter: options.adapter || 'node:sqlite',
      status: 'running',
      phase: progress.phase || 'running',
      percent: progress.percent || 0,
      scannedRows: progress.scannedRows || 0,
      totalRows: progress.totalRows || 0,
      attempt: options.attempt || 1,
      fallback: options.fallback,
      startedAt,
      nextRetryAt: 0,
      error: '',
    });
  };
}

function nowMs() {
  try { if (globalThis.performance && typeof globalThis.performance.now === 'function') return globalThis.performance.now(); }
  catch {}
  return Date.now();
}

function isCurrentStatsGeneration(options = {}) {
  return options.statsGeneration == null || Number(options.statsGeneration) === rollupStatsGeneration;
}

function recordRollupBuild(source = {}, options = {}, result = null, durationMs = 0, error = null) {
  if (!isCurrentStatsGeneration(options)) return null;
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
  if (error) entry.error = safeDbError(error);
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
  if (payload.error !== undefined || payload.hasError !== undefined || payload.errorsOnly !== undefined) return false;
  return true;
}

function canUseSessionSummaryRollup(payload = {}) {
  if (process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP === '1') return false;
  if (payload.disableUsageRollup || payload.noUsageRollup) return false;
  if (payload.query || payload.sessionId) return false;
  if (payload.model && payload.model !== 'all') return false;
  if (Array.isArray(payload.project)) return false;
  return true;
}

function canUseScopedSessionSummaryRollup(payload = {}) {
  return canUseUsageRollup(payload) && filterValues(payload.model).length > 0;
}

function buildUsageRollupForSource(args, payload = {}) {
  const rows = normalizeTokenRows(nativeSql.messageTokenRowsForSourceSql({
    ...args,
    payload,
    onProgress: payload.onProgress,
    estimatedRows: payload.estimatedRows,
  }));
  return {
    source: { id: args.source.id, label: args.source.label, dbPath: args.source.dbPath },
    rows,
  };
}

function currentUsageMessageIds(args) {
  const { where, params } = assistantWhere({}, { hasPart: args.tables.includes('part'), excludePlaceholders: true, outerAlias: 'message' });
  return new Set(args.queryAll(args.db, `select id from message where ${where}`, params)
    .map((row) => String(row.id || ''))
    .filter(Boolean));
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
    rows: normalizedRows(cached.payload, 'tokenRows', cached.payload.rows, normalizeTokenRows),
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
    hourly: normalizedRows(cached.payload, 'compactHourly', cached.payload.hourly, normalizeCompactRows),
    hourlyModels: normalizedRows(cached.payload, 'compactModels', cached.payload.hourlyModels || [], normalizeCompactRows),
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
    sessions: normalizedRows(cached.payload, 'sessions', cached.payload.sessions, normalizeSessionRows),
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
        error: safeDbError(error),
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
    const changed = buildUsageRollupForSource(args, { updatedSince, onProgress: options.onProgress, estimatedRows: options.totalRows }).rows;
    const currentIds = currentUsageMessageIds(args);
    const sessionDirectories = new Map(args.queryAll(args.db, 'select id, directory from session', [])
      .map((row) => [String(row.id || ''), String(row.directory || '')]));
    const retained = stale.rows
      .filter((row) => currentIds.has(String(row.id || '')))
      .map((row) => ({ ...row, directory: sessionDirectories.get(String(row.sessionId || '')) || '' }));
    const merged = new Map(retained.map((row) => [row.id, row]));
    for (const row of changed) merged.set(row.id, row);
    built = { source: stale.source, rows: [...merged.values()].sort((a, b) => Number(a.timeCreated || 0) - Number(b.timeCreated || 0)) };
    incremental = true;
    rollupStats.incrementalBuilds += 1;
    rollupStats.incrementalRows += changed.length;
    rollupStats.incrementalDeletedRows += stale.rows.length - retained.length;
  } else {
    built = buildUsageRollupForSource(args, { onProgress: options.onProgress, estimatedRows: options.totalRows });
  }
  try {
    options.onProgress?.({ phase: 'writing', percent: 82, scannedRows: built.rows.length, totalRows: Math.max(built.rows.length, Number(options.totalRows || 0)) });
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
        error: safeDbError(error),
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
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  try {
    onProgress({ phase: 'opening', percent: 5, scannedRows: 0, totalRows: 0 });
    let result;
    if (adapter === 'sql.js') {
      db = await openSqlJsDbReadonly(source.dbPath);
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      onProgress({ phase: 'validating', percent: 12, scannedRows: 0, totalRows: 0 });
      const sessionColumns = tableColumnNames(sqlJsAllParams, db, 'session');
      const estimatedRows = Number(sqlJsAllParams(db, "select count(*) as count from message where json_extract(data, '$.role') = ?", ['assistant'])[0]?.count || 0);
      onProgress({ phase: 'scanning', percent: 20, scannedRows: 0, totalRows: estimatedRows });
      result = readOrBuildUsageRollup({ source, db, tables, sessionColumns, queryAll: sqlJsAllParams }, { kind, onProgress, totalRows: estimatedRows });
      onProgress({ phase: 'sessions', percent: 90, scannedRows: result.rows?.length || 0, totalRows: Math.max(result.rows?.length || 0, estimatedRows) });
      try { result.usageRollup.session = readOrBuildSessionSummaryRollup({ source, db, tables, sessionColumns, queryAll: sqlJsAllParams }).usageRollup; } catch (error) { recordBestEffortFailure('rollup.session-sqljs', error, { sourceId: source.id }); }
      recordRollupBuild(source, { ...options, adapter, kind }, result, nowMs() - started, null);
      onProgress({ phase: 'completed', percent: 100, scannedRows: result.rows?.length || 0, totalRows: estimatedRows });
      return result;
    }
    db = openNativeDbReadonly(source.dbPath);
    const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
    validateTables(tables);
    onProgress({ phase: 'validating', percent: 12, scannedRows: 0, totalRows: 0 });
    const sessionColumns = tableColumnNames(nativeAllParams, db, 'session');
    const estimatedRows = Number(nativeAllParams(db, "select count(*) as count from message where json_extract(data, '$.role') = ?", ['assistant'])[0]?.count || 0);
    onProgress({ phase: 'scanning', percent: 20, scannedRows: 0, totalRows: estimatedRows });
    result = readOrBuildUsageRollup({ source, db, tables, sessionColumns, queryAll: nativeAllParams }, { kind, onProgress, totalRows: estimatedRows });
    onProgress({ phase: 'sessions', percent: 90, scannedRows: result.rows?.length || 0, totalRows: Math.max(result.rows?.length || 0, estimatedRows) });
    try { result.usageRollup.session = readOrBuildSessionSummaryRollup({ source, db, tables, sessionColumns, queryAll: nativeAllParams }).usageRollup; } catch (error) { recordBestEffortFailure('rollup.session-native', error, { sourceId: source.id }); }
    recordRollupBuild(source, { ...options, adapter, kind }, result, nowMs() - started, null);
    onProgress({ phase: 'completed', percent: 100, scannedRows: result.rows?.length || 0, totalRows: estimatedRows });
    return result;
  } catch (error) {
    recordRollupBuild(source, { ...options, adapter, kind }, null, nowMs() - started, error);
    throw error;
  } finally {
    closeDb(db);
  }
}

const scheduleUsageRollupBuild = typeof CODEARTS_BAR_ONE_SHOT_RUNTIME !== 'undefined'
  && CODEARTS_BAR_ONE_SHOT_RUNTIME === true
  ? () => ({ scheduled: false, reason: 'one-shot-runtime' })
  : function scheduleUsageRollupBuildRuntime(source, options = {}) {
  if (!isMainThread) return { scheduled: false, reason: 'main-thread-required' };
  if (process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD === '1') {
    rollupStats.skippedDisabled += 1;
    return { scheduled: false, reason: 'disabled' };
  }
  const adapter = options.adapter || 'node:sqlite';
  const statsGeneration = rollupStatsGeneration;
  const key = `${adapter}:${source.dbPath}:${options.kind || MESSAGE_TOKEN_CACHE_KIND}`;
  if (pendingBuilds.has(key)) {
    rollupStats.skippedPending += 1;
    return { scheduled: false, reason: 'pending' };
  }
  const attempt = Math.max(1, Number(options.attempt || 1));
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const entry = pendingBuildEntry(source, { ...options, adapter, attempt });
  const clearPending = () => {
    if (pendingBuilds.get(key)?.statsGeneration === statsGeneration) pendingBuilds.delete(key);
  };
  const runBuild = () => {
    if (!isCurrentStatsGeneration({ statsGeneration })) {
      clearPending();
      return;
    }
    const started = nowMs();
    const startedAt = Date.now();
    const reportProgress = progressReporter(source, { ...options, adapter, attempt, statsGeneration, startedAt });
    reportProgress({ phase: 'opening', percent: 3 });
    const workerFile = path.join(__dirname, 'usage-rollup-worker-pool.js');
    const workerPool = isMainThread && fs.existsSync(workerFile) ? module.require(workerFile) : null;
    const injectedBuild = typeof options.buildTask === 'function' ? options.buildTask : null;
    const useWorker = Boolean(!injectedBuild && isMainThread && workerPool?.usageRollupWorkerAvailable());
    const build = injectedBuild
      ? injectedBuild(source, { adapter, attempt, statsGeneration, onProgress: reportProgress })
      : useWorker
      ? workerPool.runUsageRollupWorker(source, { ...options, adapter, attempt, statsGeneration }, 'build', reportProgress)
      : buildAndWriteUsageRollupForSource(source, { ...options, adapter, attempt, statsGeneration, onProgress: reportProgress });
    let retry = null;
    Promise.resolve(build)
      .then((result) => {
        if (!isCurrentStatsGeneration({ statsGeneration })) return;
        if (useWorker) recordRollupBuild(source, { ...options, adapter, statsGeneration }, result, nowMs() - started, null);
        rollupStats.buildCompleted += 1;
        if (attempt > 1) rollupStats.buildRecovered += 1;
        publishRollupState(source, {
          adapter, status: 'ready', phase: 'completed', percent: 100,
          scannedRows: result?.usageRollup?.rowCount || 0,
          totalRows: result?.usageRollup?.rowCount || 0,
          attempt, fallback: null, startedAt, completedAt: Date.now(), nextRetryAt: 0, error: '',
        });
        if (isMainThread && buildListener) {
          try { buildListener({ source, adapter, result, completedAt: Date.now() }); }
          catch (error) { recordBestEffortFailure('rollup.build-listener', error, { sourceId: source.id }); }
        }
      })
      .catch((error) => {
        if (!isCurrentStatsGeneration({ statsGeneration })) return;
        if (useWorker) recordRollupBuild(source, { ...options, adapter, statsGeneration }, null, nowMs() - started, error);
        rollupStats.buildFailed += 1;
        const safeError = safeDbError(error);
        if (attempt < maxAttempts && process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_RETRY !== '1') {
          const retryDelayMs = Math.max(100, Number(options.retryDelayMs || 1000) * (2 ** (attempt - 1)));
          const nextRetryAt = Date.now() + retryDelayMs;
          rollupStats.buildRetries += 1;
          publishRollupState(source, {
            adapter, status: 'retrying', phase: 'backoff', percent: 0,
            attempt, fallback: 'direct-sql', startedAt, nextRetryAt, error: safeError,
          });
          retry = { retryDelayMs, nextAttempt: attempt + 1, error: safeError };
        } else {
          publishRollupState(source, {
            adapter, status: 'failed', phase: 'failed', percent: 0,
            attempt, fallback: 'direct-sql', startedAt, completedAt: Date.now(), nextRetryAt: 0, error: safeError,
          });
        }
        if (process.env.CODEARTS_BAR_DEBUG_ROLLUP === '1') {
          console.warn(`[codearts-bar] usage rollup build failed for ${source.id}: ${safeError}`);
        }
      })
      .finally(() => {
        clearPending();
        if (retry) scheduleUsageRollupBuild(source, {
          ...options,
          adapter,
          attempt: retry.nextAttempt,
          delayMs: retry.retryDelayMs,
          fallback: 'direct-sql',
          lastError: retry.error,
        });
      });
  };
  publishRollupState(source, {
    adapter,
    status: attempt > 1 ? 'retrying' : 'queued',
    phase: attempt > 1 ? 'backoff' : 'queued',
    percent: 0,
    attempt,
    fallback: options.fallback,
    startedAt: entry.startedAt,
    nextRetryAt: attempt > 1 ? entry.startedAt + Math.max(0, Number(options.delayMs || 0)) : 0,
    error: options.lastError || '',
  });
  const timer = setTimeout(runBuild, Math.max(0, Number(options.delayMs || 0)));
  timer.unref?.();
  pendingBuilds.set(key, { ...entry, statsGeneration, timer });
  rollupStats.scheduled += 1;
  return { scheduled: true };
};

function setUsageRollupBuildListener(listener) {
  buildListener = typeof listener === 'function' ? listener : null;
}

function setUsageRollupStateListener(listener) {
  stateListener = typeof listener === 'function' ? listener : null;
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
  rollupStatsGeneration += 1;
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
  canUseScopedSessionSummaryRollup,
  compactRollupIsSafeForDashboard,
  readCompactUsageRollupForSource,
  readUsageRollupForSource,
  readSessionSummaryRollupForSource,
  readOrBuildUsageRollup,
  readOrBuildSessionSummaryRollup,
  buildAndWriteUsageRollupForSource,
  scheduleUsageRollupBuild,
  aggregateRollupState,
  usageRollupStats,
  resetUsageRollupStats,
  setUsageRollupBuildListener,
  setUsageRollupStateListener,
  sessionSummaryPartFromRollup,
  sessionSummaryPartFromScopedRollups,
  dashboardPartFromCompactRollup,
  dashboardPartFromUsageRollup,
};
