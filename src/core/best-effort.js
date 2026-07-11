'use strict';

const DEFAULT_LIMIT = 100;
const events = [];
const counters = new Map();

function sanitizeError(error) {
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  return message
    .replace(/[A-Za-z]:[\\/][^\s'";]+/g, '[path]')
    .replace(/\/(?:[^/\s'"]+\/)+[^/\s'"]+/g, '[path]')
    .slice(0, 300);
}

function recordBestEffortFailure(scope, error, detail = null) {
  const key = String(scope || 'unknown');
  counters.set(key, (counters.get(key) || 0) + 1);
  events.unshift({ time: Date.now(), scope: key, message: sanitizeError(error), detail });
  if (events.length > DEFAULT_LIMIT) events.length = DEFAULT_LIMIT;
  return events[0];
}

function bestEffort(scope, operation, fallback = null, detail = null) {
  try { return operation(); }
  catch (error) { recordBestEffortFailure(scope, error, detail); return fallback; }
}

async function bestEffortAsync(scope, operation, fallback = null, detail = null) {
  try { return await operation(); }
  catch (error) { recordBestEffortFailure(scope, error, detail); return fallback; }
}

function bestEffortStats() {
  return { total: [...counters.values()].reduce((sum, value) => sum + value, 0), byScope: Object.fromEntries(counters), recent: events.slice() };
}

function resetBestEffortStats() { events.length = 0; counters.clear(); }

module.exports = { bestEffort, bestEffortAsync, recordBestEffortFailure, bestEffortStats, resetBestEffortStats, sanitizeError };
