'use strict';

const usageRollup = require('./usage-rollup');
const aggregateCache = require('./aggregate-cache');
const { aggregateCacheStats } = aggregateCache;
const { aggregateError, slowAggregateStats, resetSlowAggregateStats, maybeLogSlowAggregate, sourceList } = require('./aggregation-runtime');
const { runSqlJsWorker, warmupSqlJsWorker, clearSqlJsWorkerCaches, closeSqlJsWorker, sqlJsWorkerStats } = require('./sqljs-worker-pool');
const { runNativeWorker, warmupNativeWorker, clearNativeWorkerCaches, closeNativeWorker, nativeWorkerStats } = require('./native-worker-pool');

async function workerAggregate(operation, label, payload = {}) {
  const startedAt = performance.now();
  try {
    const result = await runSqlJsWorker(operation, { ...payload, slowAggregateMs: -1 });
    const roundTripMs = performance.now() - startedAt;
    maybeLogSlowAggregate(label, 'sql.js-worker', payload, roundTripMs, false);
    if (result && typeof result === 'object') {
      result.perf = {
        ...(result.perf || {}),
        aggregateWorker: { thread: 'worker', operation, roundTripMs: Number(roundTripMs.toFixed(1)) },
      };
    }
    return result;
  } catch (error) {
    maybeLogSlowAggregate(label, 'sql.js-worker', payload, performance.now() - startedAt, true);
    throw error;
  }
}

const getSummarySqlJs = (payload = {}) => workerAggregate('summary', 'summary', payload);
const getTrendBucketsSqlJs = (payload = {}) => workerAggregate('trendBuckets', 'trendBuckets', payload);
const getSourceStatsSqlJs = (payload = {}) => workerAggregate('sourceStats', 'sourceStats', payload);
const getModelStatsSqlJs = (payload = {}) => workerAggregate('modelStats', 'modelStats', payload);
const getSessionSummarySqlJs = (payload = {}) => workerAggregate('sessionSummary', 'sessionSummary', payload);
const getDashboardAggregatesSqlJs = (payload = {}) => workerAggregate('dashboardAggregates', 'dashboardAggregates', payload);
const getDatabaseHealthSqlJs = (payload = {}) => workerAggregate('databaseHealth', 'databaseHealth', payload);

async function nativeWorkerAggregate(operation, label, payload = {}) {
  const startedAt = performance.now();
  try {
    const result = await runNativeWorker(operation, { ...payload, slowAggregateMs: -1 });
    const roundTripMs = performance.now() - startedAt;
    maybeLogSlowAggregate(label, 'node:sqlite-worker', payload, roundTripMs, false);
    if (result && typeof result === 'object') {
      result.perf = {
        ...(result.perf || {}),
        aggregateWorker: { thread: 'worker', adapter: 'node:sqlite', operation, roundTripMs: Number(roundTripMs.toFixed(1)) },
      };
    }
    return result;
  } catch (error) {
    maybeLogSlowAggregate(label, 'node:sqlite-worker', payload, performance.now() - startedAt, true);
    throw error;
  }
}

const getSummaryNative = (payload = {}) => nativeWorkerAggregate('summary', 'summary', payload);
const getTrendBucketsNative = (payload = {}) => nativeWorkerAggregate('trendBuckets', 'trendBuckets', payload);
const getSourceStatsNative = (payload = {}) => nativeWorkerAggregate('sourceStats', 'sourceStats', payload);
const getModelStatsNative = (payload = {}) => nativeWorkerAggregate('modelStats', 'modelStats', payload);
const getSessionSummaryNative = (payload = {}) => nativeWorkerAggregate('sessionSummary', 'sessionSummary', payload);
const getDashboardAggregatesNative = (payload = {}) => nativeWorkerAggregate('dashboardAggregates', 'dashboardAggregates', payload);
const getDatabaseHealthNative = (payload = {}) => nativeWorkerAggregate('databaseHealth', 'databaseHealth', payload);

function setUsageRollupBuildListener(listener) {
  return usageRollup.setUsageRollupBuildListener((event) => {
    aggregateCache.clearAggregateCache();
    clearSqlJsWorkerCaches().catch(() => {});
    clearNativeWorkerCaches().catch(() => {});
    return listener?.(event);
  });
}

async function withFallback(payload, nativeFn, sqlJsFn) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return await nativeFn(payload); }
    catch (error) { return aggregateError(error, await sqlJsFn(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await sqlJsFn(payload));
}

function scheduleMissingRollups(payload = {}, adapter = 'node:sqlite') {
  if (!usageRollup.canUseUsageRollup(payload)) return null;
  let scheduled = false;
  for (const source of sourceList(payload)) {
    const compact = usageRollup.readCompactUsageRollupForSource(source);
    const full = compact.ok ? null : usageRollup.readUsageRollupForSource(source);
    if (compact.ok || full?.ok) continue;
    scheduled = usageRollup.scheduleUsageRollupBuild(source, { adapter, delayMs: 50, fallback: 'direct-sql' }).scheduled || scheduled;
  }
  return scheduled ? usageRollup.aggregateRollupState(sourceList(payload)) : null;
}

const getSummary = async (payload = {}) => {
  const result = await withFallback(payload, getSummaryNative, getSummarySqlJs);
  const adapter = process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || result?.nativeError ? 'sql.js' : 'node:sqlite';
  if (!result?.perf?.usageRollup?.hits || process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || result?.nativeError) {
    const state = scheduleMissingRollups(payload, adapter);
    if (state) result.rollupState = state;
  }
  return result;
};
const getTrendBuckets = (payload = {}) => withFallback(payload, getTrendBucketsNative, getTrendBucketsSqlJs);
const getSourceStats = (payload = {}) => withFallback(payload, getSourceStatsNative, getSourceStatsSqlJs);
const getModelStats = (payload = {}) => withFallback(payload, getModelStatsNative, getModelStatsSqlJs);
const getSessionSummary = (payload = {}) => withFallback(payload, getSessionSummaryNative, getSessionSummarySqlJs);
const getDashboardAggregates = async (payload = {}) => {
  const result = await withFallback(payload, getDashboardAggregatesNative, getDashboardAggregatesSqlJs);
  const adapter = process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || result?.nativeError ? 'sql.js' : 'node:sqlite';
  if (!result?.perf?.usageRollup?.hits || process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || result?.nativeError) {
    const state = scheduleMissingRollups(payload, adapter);
    if (state) result.rollupState = state;
  }
  return result;
};
const getDatabaseHealth = (payload = {}) => withFallback(payload, getDatabaseHealthNative, getDatabaseHealthSqlJs);

module.exports = {
  getSummary,
  getSummaryNative,
  getSummarySqlJs,
  getTrendBuckets,
  getTrendBucketsNative,
  getTrendBucketsSqlJs,
  getSourceStats,
  getSourceStatsNative,
  getSourceStatsSqlJs,
  getModelStats,
  getModelStatsNative,
  getModelStatsSqlJs,
  getSessionSummary,
  getSessionSummaryNative,
  getSessionSummarySqlJs,
  getDashboardAggregates,
  getDashboardAggregatesNative,
  getDashboardAggregatesSqlJs,
  getDatabaseHealth,
  getDatabaseHealthNative,
  getDatabaseHealthSqlJs,
  aggregateCacheStats,
  usageRollupStats: usageRollup.usageRollupStats,
  setUsageRollupBuildListener,
  setUsageRollupStateListener: usageRollup.setUsageRollupStateListener,
  aggregateRollupState: usageRollup.aggregateRollupState,
  slowAggregateStats,
  resetSlowAggregateStats,
  sqlJsWorkerStats,
  warmupSqlJsWorker,
  clearSqlJsWorkerCaches,
  closeSqlJsWorker,
  warmupNativeWorker,
  nativeWorkerStats,
  closeNativeWorker,
  clearNativeWorkerCaches,
};
