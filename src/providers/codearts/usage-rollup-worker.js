'use strict';

const { parentPort } = require('node:worker_threads');
const { buildAndWriteUsageRollupForSource } = require('./usage-rollup');
const { maintainUsageRollupForSource } = require('./usage-rollup-maintenance');

parentPort.once('message', async ({ operation = 'build', source, options }) => {
  try {
    const result = operation === 'maintain'
      ? await maintainUsageRollupForSource(source, options || {})
      : await buildAndWriteUsageRollupForSource(source, options || {});
    parentPort.postMessage({ ok: true, result: { usageRollup: result?.usageRollup || null } });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || '',
      },
    });
  }
});
