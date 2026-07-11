'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsStore, normalizeSettings } = require('../src/settings');
const { writeJsonAtomic } = require('../src/core/atomic-file');
const { resolvePollInterval } = require('../src/main/db-watch-service');

const normalized = normalizeSettings({ dbWatchVisiblePollMs: 500, dbWatchHiddenPollMs: 800 }, {});
assert.equal(normalized.dbWatchVisiblePollMs, 1000);
assert.equal(normalized.dbWatchHiddenPollMs, 1000);
assert.equal(resolvePollInterval({ dbWatchVisiblePollMs: 3500, dbWatchHiddenPollMs: 18000 }, true), 3500);
assert.equal(resolvePollInterval({ dbWatchVisiblePollMs: 3500, dbWatchHiddenPollMs: 18000 }, false), 18000);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-settings-store-'));
  const file = path.join(dir, 'settings.json');
  writeJsonAtomic(file, { dailyLimit: 123000 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).dailyLimit, 123000);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), [], 'atomic writes should not leave temp files');
  const store = createSettingsStore({ file, env: {} });
  const events = [];
  const stop = store.onDidChange((event) => events.push(event));
  try {
    assert.equal(store.get().dailyLimit, 123000);
    const saved = store.save({ dailyLimit: 321000, dbWatchVisiblePollMs: 3000, dbWatchHiddenPollMs: 22000 });
    assert.equal(saved.dailyLimit, 321000);
    assert.equal(events.at(-1).reason, 'save');
    fs.writeFileSync(file, JSON.stringify({ dailyLimit: 654000, dbWatchVisiblePollMs: 2500, dbWatchHiddenPollMs: 30000 }), 'utf8');
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !events.some((event) => event.reason === 'watch')) await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(events.some((event) => event.reason === 'watch'), true, 'external settings write should emit a watch event');
    assert.equal(store.get().dailyLimit, 654000);
    assert.equal(store.get().dbWatchHiddenPollMs, 30000);
    console.log(`ok - settings store watch events=${events.length}`);
  } finally {
    stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
