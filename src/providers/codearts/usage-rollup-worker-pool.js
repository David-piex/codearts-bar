'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'usage-rollup-worker.js');

function usageRollupWorkerAvailable() { return fs.existsSync(WORKER_PATH); }

function runUsageRollupWorker(source, options = {}, operation = 'build', onProgress = null) {
  const timeoutMs = Math.max(5000, Number(options.workerTimeoutMs || 120000));
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { name: 'codearts-usage-rollup' });
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      worker.terminate().catch(() => {});
      operation(value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`usage rollup worker timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        if (typeof onProgress === 'function') onProgress(message.state || {});
        return;
      }
      if (message?.ok) finish(resolve, message.result);
      else {
        const error = new Error(message?.error?.message || 'usage rollup worker failed');
        error.name = message?.error?.name || 'Error';
        if (message?.error?.stack) error.stack = message.error.stack;
        finish(reject, error);
      }
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(reject, new Error(`usage rollup worker exited with code ${code}`));
    });
    worker.postMessage({ operation, source, options: { ...options, delayMs: 0, reportProgress: true } });
  });
}

module.exports = { runUsageRollupWorker, usageRollupWorkerAvailable };
