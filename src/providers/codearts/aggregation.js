'use strict';

const engine = require('./aggregation-engine');
const usageRollup = require('./usage-rollup');
const { aggregateCacheStats } = require('./aggregate-cache');
const { aggregateError, slowAggregateStats, resetSlowAggregateStats, maybeLogSlowAggregate, sourceList } = require('./aggregation-runtime');
const { runSqlJsWorker, warmupSqlJsWorker, clearSqlJsWorkerCaches, closeSqlJsWorker, sqlJsWorkerStats } = require('./sqljs-worker-pool');

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

async function withFallback(payload, nativeFn, sqlJsFn) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return nativeFn(payload); }
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
  const result = await withFallback(payload, engine.getSummaryNative, getSummarySqlJs);
  if (result?.nativeError || process.env.CODEARTS_BAR_FORCE_SQLJS === '1') {
    const state = scheduleMissingRollups(payload, 'sql.js');
    if (state) result.rollupState = state;
  }
  return result;
};
const getTrendBuckets = (payload = {}) => withFallback(payload, engine.getTrendBucketsNative, getTrendBucketsSqlJs);
const getSourceStats = (payload = {}) => withFallback(payload, engine.getSourceStatsNative, getSourceStatsSqlJs);
const getModelStats = (payload = {}) => withFallback(payload, engine.getModelStatsNative, getModelStatsSqlJs);
const getSessionSummary = (payload = {}) => withFallback(payload, engine.getSessionSummaryNative, getSessionSummarySqlJs);
const getDashboardAggregates = async (payload = {}) => {
  const result = await withFallback(payload, engine.getDashboardAggregatesNative, getDashboardAggregatesSqlJs);
  if (result?.nativeError || process.env.CODEARTS_BAR_FORCE_SQLJS === '1') {
    const state = scheduleMissingRollups(payload, 'sql.js');
    if (state) result.rollupState = state;
  }
  return result;
};
const getDatabaseHealth = (payload = {}) => withFallback(payload, engine.getDatabaseHealthNative, getDatabaseHealthSqlJs);

module.exports = {
  getSummary,
  getSummaryNative: engine.getSummaryNative,
  getSummarySqlJs,
  getTrendBuckets,
  getTrendBucketsNative: engine.getTrendBucketsNative,
  getTrendBucketsSqlJs,
  getSourceStats,
  getSourceStatsNative: engine.getSourceStatsNative,
  getSourceStatsSqlJs,
  getModelStats,
  getModelStatsNative: engine.getModelStatsNative,
  getModelStatsSqlJs,
  getSessionSummary,
  getSessionSummaryNative: engine.getSessionSummaryNative,
  getSessionSummarySqlJs,
  getDashboardAggregates,
  getDashboardAggregatesNative: engine.getDashboardAggregatesNative,
  getDashboardAggregatesSqlJs,
  getDatabaseHealth,
  getDatabaseHealthNative: engine.getDatabaseHealthNative,
  getDatabaseHealthSqlJs,
  aggregateCacheStats,
  usageRollupStats: usageRollup.usageRollupStats,
  setUsageRollupBuildListener: usageRollup.setUsageRollupBuildListener,
  setUsageRollupStateListener: usageRollup.setUsageRollupStateListener,
  aggregateRollupState: usageRollup.aggregateRollupState,
  slowAggregateStats,
  resetSlowAggregateStats,
  sqlJsWorkerStats,
  warmupSqlJsWorker,
  clearSqlJsWorkerCaches,
  closeSqlJsWorker,
};
