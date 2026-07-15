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

function sanitizeStack(error) {
  if (!error?.stack) return null;
  return String(error.stack)
    .split('\n')
    .slice(0, 5)
    .map((line) => sanitizeError({ message: line.trim() }))
    .filter(Boolean);
}

function recordBestEffortFailure(scope, error, detail = null) {
  const key = String(scope || 'unknown');
  const message = sanitizeError(error);
  counters.set(key, (counters.get(key) || 0) + 1);
  const now = Date.now();
  const existing = events.find((event) => event.scope === key && event.message === message && !event.resolved);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    if (detail !== null) existing.detail = detail;
    return existing;
  }
  events.unshift({ time: now, lastSeen: now, scope: key, message, detail, count: 1, resolved: false, stack: sanitizeStack(error) });
  if (events.length > DEFAULT_LIMIT) events.length = DEFAULT_LIMIT;
  return events[0];
}

function markBestEffortResolved(scope, message) {
  const key = String(scope || 'unknown');
  const safeMessage = sanitizeError(message);
  const event = events.find((item) => item.scope === key && item.message === safeMessage && !item.resolved);
  if (!event) return false;
  event.resolved = true;
  event.resolvedAt = Date.now();
  return true;
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

module.exports = { bestEffort, bestEffortAsync, recordBestEffortFailure, markBestEffortResolved, bestEffortStats, resetBestEffortStats, sanitizeError };
