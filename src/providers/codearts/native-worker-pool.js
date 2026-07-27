'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'native-worker.js');
const DEFAULT_TIMEOUT_MS = 120000;
let worker = null;
let nextId = 1;
let generation = 0;
let workerEnvSignature = '';
const pending = new Map();
const stats = {
  started: 0,
  restarts: 0,
  requests: 0,
  completed: 0,
  failed: 0,
  timedOut: 0,
  warmups: 0,
  warmupCompleted: 0,
  inFlight: 0,
  lastError: null,
};

function rejectPending(error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
  stats.inFlight = 0;
}

function workerFailure(target, error) {
  if (worker !== target) return;
  worker = null;
  workerEnvSignature = '';
  stats.lastError = error?.message || String(error);
  rejectPending(error instanceof Error ? error : new Error(stats.lastError));
}

function currentWorkerEnvSignature() {
  return JSON.stringify({
    configDir: process.env.CODEARTS_BAR_CONFIG_DIR || '',
    disableRollup: process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP || '',
    disableRollupBuild: process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD || '',
    workerTest: process.env.CODEARTS_BAR_WORKER_TEST || '',
  });
}

function ensureWorker() {
  const envSignature = currentWorkerEnvSignature();
  if (worker && workerEnvSignature === envSignature) return worker;
  if (worker) {
    const stale = worker;
    worker = null;
    workerEnvSignature = '';
    rejectPending(new Error('native aggregation worker environment changed'));
    stale.terminate().catch(() => {});
  }
  const target = new Worker(WORKER_PATH, { name: 'codearts-native-aggregation' });
  generation += 1;
  stats.started += 1;
  if (stats.started > 1) stats.restarts += 1;
  target.unref();
  target.on('message', (message) => {
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    stats.inFlight = pending.size;
    if (!pending.size) target.unref();
    if (message.ok) {
      stats.completed += 1;
      entry.resolve(message.result);
      return;
    }
    stats.failed += 1;
    const error = new Error(message?.error?.message || 'native worker request failed');
    error.name = message?.error?.name || 'Error';
    if (message?.error?.stack) error.stack = message.error.stack;
    entry.reject(error);
  });
  target.on('error', (error) => workerFailure(target, error));
  target.on('exit', (code) => {
    if (worker !== target) return;
    workerFailure(target, new Error(`native aggregation worker exited with code ${code}`));
  });
  worker = target;
  workerEnvSignature = envSignature;
  return worker;
}

function runNativeWorker(operation, payload = {}, options = {}) {
  const target = ensureWorker();
  const id = nextId++;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || payload.workerTimeoutMs || DEFAULT_TIMEOUT_MS));
  stats.requests += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      stats.inFlight = pending.size;
      stats.failed += 1;
      stats.timedOut += 1;
      entry.reject(new Error(`native worker ${operation} timed out after ${timeoutMs}ms`));
      target.terminate().catch(() => {});
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, { resolve, reject, timer, operation, generation });
    target.ref();
    stats.inFlight = pending.size;
    target.postMessage({ id, operation, payload });
  });
}

async function closeNativeWorker() {
  const target = worker;
  if (!target) return;
  worker = null;
  workerEnvSignature = '';
  rejectPending(new Error('native aggregation worker closed'));
  await target.terminate();
}

async function warmupNativeWorker(options = {}) {
  stats.warmups += 1;
  const result = await runNativeWorker('__warmup', {}, { timeoutMs: Math.max(1000, Number(options.timeoutMs || 30000)) });
  stats.warmupCompleted += 1;
  return result;
}

function clearNativeWorkerCaches() {
  if (!worker) return Promise.resolve(false);
  return runNativeWorker('__clearAggregateCache', {}, { timeoutMs: 10000 });
}

function nativeWorkerStats() {
  return { ...stats, inFlight: pending.size, running: Boolean(worker), generation };
}

module.exports = { runNativeWorker, warmupNativeWorker, clearNativeWorkerCaches, closeNativeWorker, nativeWorkerStats };
