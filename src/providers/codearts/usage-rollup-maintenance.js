'use strict';

const { assistantWhere, validateTables } = require('./sources');
const {
  openNativeDbReadonly,
  openSqlJsDbReadonly,
  nativeAll,
  nativeAllParams,
  sqlJsAll,
  sqlJsAllParams,
  closeDb,
} = require('./sqlite');
const { readUsageRollupForSource, buildAndWriteUsageRollupForSource } = require('./usage-rollup');
const workerPool = require('./usage-rollup-worker-pool');
const { recordBestEffortFailure } = require('../../core/best-effort');

const HOUR_MS = 60 * 60 * 1000;
const pending = new Map();

async function maintainUsageRollupForSource(source, options = {}) {
  const minNewRows = Math.max(1, Number(options.minNewRows || 100));
  const cooldownMs = Math.max(0, Number(options.cooldownMs || HOUR_MS));
  const lastBuildMs = Math.max(0, Number(options.lastBuildMs || 0));
  if (lastBuildMs && Date.now() - lastBuildMs < cooldownMs) {
    return { usageRollup: { status: 'maintenance-cooldown', changedRows: 0, built: false } };
  }
  const stale = readUsageRollupForSource(source, { allowStale: true });
  const maxUpdatedTime = stale.ok ? stale.rows.reduce((max, row) => Math.max(max, Number(row.timeUpdated || row.timeCreated || 0)), 0) : 0;
  const adapter = options.adapter || 'node:sqlite';
  let db;
  try {
    db = adapter === 'sql.js' ? await openSqlJsDbReadonly(source.dbPath) : openNativeDbReadonly(source.dbPath);
    const queryAll = adapter === 'sql.js' ? sqlJsAllParams : nativeAllParams;
    const listAll = adapter === 'sql.js' ? sqlJsAll : nativeAll;
    const tables = listAll(db, "select name from sqlite_master where type='table'").map((row) => row.name);
    validateTables(tables);
    const { where, params } = assistantWhere(maxUpdatedTime ? { updatedSince: maxUpdatedTime + 1 } : {}, {
      hasPart: tables.includes('part'),
      excludePlaceholders: true,
      outerAlias: 'message',
    });
    const changedRows = Number(queryAll(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0);
    if (changedRows < minNewRows) {
      return { usageRollup: { status: 'maintenance-threshold', changedRows, minNewRows, built: false } };
    }
  } finally {
    closeDb(db);
  }
  const built = await buildAndWriteUsageRollupForSource(source, { ...options, adapter });
  return { ...built, usageRollup: { ...(built.usageRollup || {}), built: true } };
}

function scheduleUsageRollupMaintenance(source, options = {}) {
  if (process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD === '1') return { scheduled: false, reason: 'disabled' };
  const adapter = options.adapter || 'node:sqlite';
  const key = `${adapter}:${source.dbPath}`;
  if (pending.has(key)) return { scheduled: false, reason: 'pending' };
  const timer = setTimeout(() => {
    const { onBuilt, ...workerOptions } = options;
    const run = workerPool.usageRollupWorkerAvailable()
      ? workerPool.runUsageRollupWorker(source, { ...workerOptions, adapter }, 'maintain')
      : maintainUsageRollupForSource(source, { ...workerOptions, adapter });
    Promise.resolve(run)
      .then((result) => {
        if (result?.usageRollup?.built && typeof onBuilt === 'function') onBuilt({ source, adapter, result, completedAt: Date.now() });
      })
      .catch((error) => recordBestEffortFailure('rollup.maintenance', error, { sourceId: source.id }))
      .finally(() => pending.delete(key));
  }, Math.max(0, Number(options.delayMs || 0)));
  timer.unref?.();
  pending.set(key, timer);
  return { scheduled: true };
}

module.exports = { maintainUsageRollupForSource, scheduleUsageRollupMaintenance };
