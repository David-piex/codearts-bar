'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ScoredCache } = require('../src/core/scored-cache');
const { databaseFingerprint } = require('../src/core/source-fingerprint');
const { mergeCollections } = require('../src/providers/codearts/collect');
const sqlite = require('../src/providers/codearts/sqlite');
const rollup = require('../src/providers/codearts/usage-rollup');
const workerPool = require('../src/providers/codearts/sqljs-worker-pool');

function waitForBuild(source, adapter) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('background rollup build timed out')), 30000);
    rollup.setUsageRollupBuildListener((event) => {
      if (event.source.dbPath !== source.dbPath) return;
      clearTimeout(timer);
      resolve(event);
    });
    const scheduled = rollup.scheduleUsageRollupBuild(source, { adapter });
    if (!scheduled.scheduled) {
      clearTimeout(timer);
      reject(new Error(`rollup was not scheduled: ${scheduled.reason}`));
    }
  });
}

(async () => {
  let now = 0;
  const cache = new ScoredCache(2, { now: () => now });
  cache.set('hot', 1).set('cold', 2);
  cache.get('hot');
  cache.get('hot');
  now += 10 * 60000;
  cache.set('new', 3);
  assert.equal(cache.get('hot'), 1);
  assert.equal(cache.get('cold'), undefined);
  assert.equal(cache.get('new'), 3);

  const merged = mergeCollections([
    { source: { id: 'a', label: 'A' }, dbPath: 'a', stat: { size: 1, mtimeMs: 1 }, tables: [], adapter: 'x', messages: [{ id: 'm1' }], sessions: [{ id: 's1', time_updated: 1 }], parts: [{ id: 'p1', time_created: 2 }] },
    { source: { id: 'b', label: 'B' }, dbPath: 'b', stat: { size: 1, mtimeMs: 1 }, tables: [], adapter: 'x', messages: [{ id: 'm2' }], sessions: [{ id: 's2', time_updated: 2 }], parts: [{ id: 'p2', time_created: 1 }] },
  ]);
  assert.deepEqual(merged.messages.map((item) => item.id), ['m1', 'm2']);
  assert.deepEqual(merged.sessions.map((item) => item.id), ['s2', 's1']);
  assert.deepEqual(merged.parts.map((item) => item.id), ['p2', 'p1']);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-optimization-'));
  const dbPath = path.join(tmpDir, 'fixture.db');
  const previousConfig = process.env.CODEARTS_BAR_CONFIG_DIR;
  try {
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'opencode-fixture.db'), dbPath);
    process.env.CODEARTS_BAR_CONFIG_DIR = path.join(tmpDir, 'config');
    const source = { id: 'custom', label: 'Custom', dbPath };
    const before = databaseFingerprint(fs, [source]);
    fs.writeFileSync(`${dbPath}.touch`, 'changed');
    assert.notEqual(databaseFingerprint(fs, [source]), before);

    const adapter = sqlite.nativeSqliteStatus().available ? 'node:sqlite' : 'sql.js';
    const event = await waitForBuild(source, adapter);
    assert.equal(event.result.usageRollup.status.includes('failed'), false);
    assert.ok(rollup.readUsageRollupForSource(source).ok);

    const warmed = await workerPool.warmupSqlJsWorker({ timeoutMs: 30000 });
    assert.equal(warmed.ready, true);
    assert.ok(workerPool.sqlJsWorkerStats().warmupCompleted >= 1);
  } finally {
    rollup.setUsageRollupBuildListener(null);
    rollup.resetUsageRollupStats();
    await workerPool.closeSqlJsWorker();
    if (previousConfig == null) delete process.env.CODEARTS_BAR_CONFIG_DIR;
    else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfig;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('ok - performance optimization primitives and background workers');
})().catch((error) => { console.error(error); process.exit(1); });
