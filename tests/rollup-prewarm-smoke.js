'use strict';

const assert = require('node:assert/strict');
const { createUsageRollupPrewarmer, prewarmAfterRefresh, prewarmDelay, resolveRollupAdapter } = require('../src/main/rollup-prewarm');

const calls = [];
const onBuilt = () => {};
const prewarmer = createUsageRollupPrewarmer({
  loadSettings: () => ({ marker: 'settings' }),
  listDataSources: (settings) => [{ id: `source-${settings.marker}`, dbPath: 'fixture.db' }],
  nativeSqliteStatus: () => ({ available: true }),
  scheduleMaintenance: (source, options) => {
    calls.push({ source, options });
    return { scheduled: true };
  },
  onBuilt,
  forceSqlJs: () => false,
});

const startup = prewarmer.schedule('startup');
assert.equal(startup.adapter, 'node:sqlite');
assert.equal(startup.scheduled, 1);
assert.equal(calls[0].source.id, 'source-settings');
assert.equal(calls[0].options.minNewRows, 1);
assert.equal(calls[0].options.cooldownMs, 0);
assert.equal(calls[0].options.delayMs, 0);
assert.equal(calls[0].options.onBuilt, onBuilt);

prewarmer.schedule('fswatch');
assert.equal(calls[1].options.delayMs, 350);
assert.equal(prewarmDelay('startup'), 0);
assert.equal(prewarmDelay('poll'), 350);
assert.equal(resolveRollupAdapter(true, { available: true }), 'sql.js');
assert.equal(resolveRollupAdapter(false, { available: false }), 'sql.js');

console.log('ok - usage rollup startup and database-change prewarm');

(async () => {
  const order = [];
  let resolveRefresh;
  const refresh = new Promise((resolve) => { resolveRefresh = resolve; });
  const done = prewarmAfterRefresh(refresh.then(() => order.push('summary')), { schedule: () => order.push('prewarm') });
  await Promise.resolve();
  assert.deepEqual(order, []);
  resolveRefresh();
  await done;
  assert.deepEqual(order, ['summary', 'prewarm']);
  assert.equal(await prewarmAfterRefresh(Promise.resolve('ok'), { schedule: () => { throw new Error('ignored'); } }), 'ok');
  console.log('ok - startup summary completes before rollup prewarm');
})().catch((error) => { console.error(error); process.exitCode = 1; });
