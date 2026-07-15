'use strict';
const assert = require('node:assert/strict');
const { bestEffort, bestEffortAsync, bestEffortStats, resetBestEffortStats } = require('../src/core/best-effort');
(async () => {
  resetBestEffortStats();
  assert.equal(bestEffort('test.sync', () => { throw new Error('C:\\private\\db.sqlite failed'); }, 'fallback'), 'fallback');
  assert.equal(bestEffort('test.sync', () => { throw new Error('C:\\private\\db.sqlite failed'); }, 'fallback'), 'fallback');
  assert.equal(await bestEffortAsync('test.async', async () => { throw new Error('/home/user/private failed'); }, 42), 42);
  const stats = bestEffortStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byScope['test.sync'], 2);
  assert.equal(stats.byScope['test.async'], 1);
  assert.ok(stats.recent.every((item) => !item.message.includes('private')));
  assert.equal(stats.recent.find((item) => item.scope === 'test.sync').count, 2);
  assert.ok(stats.recent.every((item) => !item.stack || item.stack.every((line) => !line.includes('private'))));
  console.log('ok - best effort failures observable and redacted');
})().catch((error) => { console.error(error); process.exit(1); });
