'use strict';

const { parentPort } = require('node:worker_threads');
const engine = require('./aggregation-engine');
const pagination = require('./pagination');
const { nativeSqliteStatus } = require('./sqlite');
const aggregateCache = require('./aggregate-cache');
const usageRollup = require('./usage-rollup');

const operations = {
  summary: engine.getSummaryNative,
  trendBuckets: engine.getTrendBucketsNative,
  sourceStats: engine.getSourceStatsNative,
  modelStats: engine.getModelStatsNative,
  sessionSummary: engine.getSessionSummaryNative,
  dashboardAggregates: engine.getDashboardAggregatesNative,
  databaseHealth: engine.getDatabaseHealthNative,
  requestsPage: pagination.getRequestsPageNative,
  sessionRequestsPage: pagination.getSessionRequestsPageNative,
  sessionsPage: pagination.getSessionsPageNative,
};

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || '',
  };
}

parentPort.on('message', async ({ id, operation, payload }) => {
  try {
    if (operation === '__warmup') {
      parentPort.postMessage({ id, ok: true, result: nativeSqliteStatus() });
      return;
    }
    if (operation === '__clearAggregateCache') {
      aggregateCache.clearAggregateCache();
      usageRollup.resetUsageRollupStats();
      parentPort.postMessage({ id, ok: true, result: true });
      return;
    }
    if (operation === '__testCrash' && process.env.CODEARTS_BAR_WORKER_TEST === '1') process.exit(97);
    const handler = operations[operation];
    if (!handler) throw new Error(`Unknown native worker operation: ${operation}`);
    const result = await handler(payload || {});
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: serializeError(error) });
  }
});
