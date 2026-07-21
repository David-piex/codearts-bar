'use strict';

function resolveRollupAdapter(forceSqlJs, nativeStatus) {
  return forceSqlJs === true || !nativeStatus?.available ? 'sql.js' : 'node:sqlite';
}

function prewarmDelay(reason) {
  return reason === 'startup' ? 0 : 350;
}

function prewarmAfterRefresh(refreshPromise, prewarmer) {
  return Promise.resolve(refreshPromise).finally(() => {
    try { prewarmer?.schedule?.('startup'); } catch {}
  });
}

function createUsageRollupPrewarmer({
  loadSettings,
  listDataSources,
  nativeSqliteStatus,
  scheduleMaintenance,
  onBuilt,
  forceSqlJs = () => process.env.CODEARTS_BAR_FORCE_SQLJS === '1',
} = {}) {
  function schedule(reason = 'database-change') {
    const settings = loadSettings?.() || {};
    const adapter = resolveRollupAdapter(Boolean(forceSqlJs?.()), nativeSqliteStatus?.() || {});
    const sources = listDataSources?.(settings) || [];
    const results = sources.map((source) => scheduleMaintenance?.(source, {
      adapter,
      minNewRows: 1,
      cooldownMs: 0,
      delayMs: prewarmDelay(reason),
      onBuilt,
    }) || { scheduled: false, reason: 'unavailable' });
    return {
      reason,
      adapter,
      sources: sources.length,
      scheduled: results.filter((result) => result?.scheduled).length,
      results,
    };
  }

  return { schedule };
}

module.exports = { createUsageRollupPrewarmer, prewarmAfterRefresh, prewarmDelay, resolveRollupAdapter };
