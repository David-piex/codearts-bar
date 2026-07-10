'use strict';

const { parentPort } = require('node:worker_threads');
const engine = require('./aggregation-engine');
const aggregateCache = require('./aggregate-cache');
const usageRollup = require('./usage-rollup');

const operations = {
  summary: engine.getSummarySqlJs,
  trendBuckets: engine.getTrendBucketsSqlJs,
  sourceStats: engine.getSourceStatsSqlJs,
  modelStats: engine.getModelStatsSqlJs,
  sessionSummary: engine.getSessionSummarySqlJs,
  dashboardAggregates: engine.getDashboardAggregatesSqlJs,
  databaseHealth: engine.getDatabaseHealthSqlJs,
};

parentPort.on('message', async ({ id, operation, payload }) => {
  if (operation === '__clearAggregateCache') {
    aggregateCache.clearAggregateCache();
    usageRollup.resetUsageRollupStats();
    parentPort.postMessage({ id, ok: true, result: true });
    return;
  }
  try {
    const handler = operations[operation];
    if (!handler) throw new Error(`Unknown sql.js worker operation: ${operation}`);
    const result = await handler(payload || {});
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || '',
      },
    });
  }
});
