'use strict';
const assert = require('node:assert/strict');
const { createDbWatchService, resolvePollInterval } = require('../src/main/db-watch-service');

const delays = [];
const callbacks = [];
const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
global.setTimeout = (fn, delay) => { const token={fn,delay,unref(){}}; delays.push(delay); callbacks.push(token); return token; };
global.clearTimeout = () => {};
try {
  let visible = true;
  let mtimeMs = 1;
  let changes = 0;
  const fakeFs = { existsSync: () => false, statSync: () => ({ mtimeMs, size: 1 }), watch: () => ({ close() {} }) };
  const settings = { dbWatchVisiblePollMs: 4000, dbWatchHiddenPollMs: 15000 };
  const service = createDbWatchService({ fs: fakeFs, loadSettings: () => settings, localProvider: { watchTargets: () => ['db'] }, dashboardWindowVisible: () => visible, onDatabaseChange: () => { changes += 1; } });
  service.schedule();
  assert.equal(delays.at(-1), 4000);
  mtimeMs = 2;
  callbacks[0].fn();
  assert.equal(changes, 1);
  visible = false;
  service.reschedulePoll();
  assert.equal(delays.at(-1), 15000);
  visible = true;
  service.reschedulePoll();
  assert.equal(delays.at(-1), 4000);
  service.cleanup();
  assert.equal(resolvePollInterval(settings, false), 15000);
  console.log('ok - db watch adaptive polling');
} finally {
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
}
