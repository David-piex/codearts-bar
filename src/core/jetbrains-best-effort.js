'use strict';

function recordBestEffortFailure() {}

function bestEffort(scope, operation, fallback = null) {
  try { return operation(); } catch (error) { recordBestEffortFailure(scope, error); return fallback; }
}

async function bestEffortAsync(scope, operation, fallback = null) {
  try { return await operation(); } catch (error) { recordBestEffortFailure(scope, error); return fallback; }
}

function bestEffortStats() { return { total: 0, byScope: {}, recent: [] }; }
function resetBestEffortStats() {}
function sanitizeError(error) { return String(error?.message || error || 'Unknown error').slice(0, 300); }

module.exports = { bestEffort, bestEffortAsync, recordBestEffortFailure, bestEffortStats, resetBestEffortStats, sanitizeError };
