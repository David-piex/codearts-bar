'use strict';

const engine = require('./aggregation-engine');
const usageRollup = require('./usage-rollup');
const { aggregateCacheStats } = require('./aggregate-cache');
const { aggregateError, slowAggregateStats, resetSlowAggregateStats, maybeLogSlowAggregate } = require('./aggregation-runtime');
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

const getSummary = (payload = {}) => withFallback(payload, engine.getSummaryNative, getSummarySqlJs);
const getTrendBuckets = (payload = {}) => withFallback(payload, engine.getTrendBucketsNative, getTrendBucketsSqlJs);
const getSourceStats = (payload = {}) => withFallback(payload, engine.getSourceStatsNative, getSourceStatsSqlJs);
const getModelStats = (payload = {}) => withFallback(payload, engine.getModelStatsNative, getModelStatsSqlJs);
const getSessionSummary = (payload = {}) => withFallback(payload, engine.getSessionSummaryNative, getSessionSummarySqlJs);
const getDashboardAggregates = (payload = {}) => withFallback(payload, engine.getDashboardAggregatesNative, getDashboardAggregatesSqlJs);
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
  slowAggregateStats,
  resetSlowAggregateStats,
  sqlJsWorkerStats,
  warmupSqlJsWorker,
  clearSqlJsWorkerCaches,
  closeSqlJsWorker,
};
