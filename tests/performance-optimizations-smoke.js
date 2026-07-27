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
const nativeWorkerPool = require('../src/providers/codearts/native-worker-pool');
const aggregator = require('../src/core/aggregator');
const snapshotData = require('../src/codeartsData');
const localProvider = require('../src/providers/codeartsLocal');

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

    const row = { id: 'message-1', source: 'custom', session_id: 'session-1', time_created: 10, time_updated: 20, data: JSON.stringify({ role: 'assistant', modelID: 'model-1', tokens: { input: 2, output: 3 } }) };
    const partMap = aggregator.buildPartMap([{ id: 'part-1', source: 'custom', message_id: 'message-1', time_created: 12, data: JSON.stringify({ type: 'step-finish', tokens: { input: 4, output: 5 } }) }]);
    const firstAnalysis = aggregator.analyzeMessage(row, partMap);
    const secondAnalysis = aggregator.analyzeMessage(row, partMap);
    assert.strictEqual(firstAnalysis, secondAnalysis, 'message analysis should be cached for the same row and part map');
    assert.deepEqual(firstAnalysis.token, { total: 9, input: 4, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
    const ttftRows = [
      { id: 'near', session_id: 'session-ttft', time_created: 1000, data: JSON.stringify({ role: 'assistant', time: { created: 1000 }, tokens: { output: 1 } }) },
      { id: 'later', session_id: 'session-ttft', time_created: 9000, data: JSON.stringify({ role: 'assistant', time: { created: 9000 }, tokens: { output: 1 } }) },
      { id: 'other', session_id: 'other-session', time_created: 1100, data: JSON.stringify({ role: 'assistant', time: { created: 1100 }, tokens: { output: 1 } }) },
    ];
    const ttftMap = aggregator.buildTtftMap(ttftRows, [
      { sessionId: 'session-ttft', firstTokenAt: 1200, ttftMs: 20 },
      { sessionId: 'session-ttft', firstTokenAt: 1300, ttftMs: 30 },
      { sessionId: 'other-session', firstTokenAt: 1300, ttftMs: 40 },
    ]);
    assert.equal(ttftMap.get('near')?.ttftMs, 20, 'the nearest session-local assistant should receive the first matching TTFT event');
    assert.equal(ttftMap.get('other')?.ttftMs, 40, 'TTFT lookup must remain isolated by session');
    assert.equal(ttftMap.has('later'), false, 'an event outside its nearest time window must not be assigned to another message');
    const invalid = aggregator.analyzeMessage({ id: 'invalid', data: '{bad json' }, new Map());
    assert.equal(invalid.meaningful, false);
    assert.equal(invalid.token.total, 0);

    const originalCollectRows = localProvider.collectRows;
    localProvider.collectRows = async () => { throw new Error('optimized snapshot must not collect all rows'); };
    try {
      const summarySnapshot = await snapshotData.getSnapshotSummaryAsync({ dbPath, timestamp: Date.UTC(2026, 6, 8, 12), fixtureMode: true, useSavedSettings: false });
      assert.equal(summarySnapshot.ok, true);
      assert.equal(summarySnapshot.freshness.source, 'aggregate-page');
      assert.ok(summarySnapshot.perf.snapshotMemory.heapPeak >= summarySnapshot.perf.snapshotMemory.heapBefore);
      assert.ok(summarySnapshot.perf.snapshotMemory.rssPeak >= summarySnapshot.perf.snapshotMemory.rssBefore);
      assert.equal(typeof summarySnapshot.perf.snapshotMemory.gcCount, 'number');
    } finally { localProvider.collectRows = originalCollectRows; }

    const warmed = await workerPool.warmupSqlJsWorker({ timeoutMs: 30000 });
    assert.equal(warmed.ready, true);
    assert.ok(workerPool.sqlJsWorkerStats().warmupCompleted >= 1);
    if (sqlite.nativeSqliteStatus().available) {
      const nativeWarmed = await nativeWorkerPool.warmupNativeWorker({ timeoutMs: 30000 });
      assert.equal(nativeWarmed.available, true);
      assert.ok(nativeWorkerPool.nativeWorkerStats().warmupCompleted >= 1);
      await nativeWorkerPool.closeNativeWorker();
      process.env.CODEARTS_BAR_WORKER_TEST = '1';
      await assert.rejects(
        () => nativeWorkerPool.runNativeWorker('__testCrash', {}, { timeoutMs: 5000 }),
        /exited with code 97/,
      );
      delete process.env.CODEARTS_BAR_WORKER_TEST;
      const restarted = await nativeWorkerPool.warmupNativeWorker({ timeoutMs: 30000 });
      assert.equal(restarted.available, true, 'native aggregation worker should restart after a crash');
      assert.ok(nativeWorkerPool.nativeWorkerStats().restarts >= 1);
    }
  } finally {
    rollup.setUsageRollupBuildListener(null);
    rollup.resetUsageRollupStats();
    await workerPool.closeSqlJsWorker();
    await nativeWorkerPool.closeNativeWorker();
    delete process.env.CODEARTS_BAR_WORKER_TEST;
    if (previousConfig == null) delete process.env.CODEARTS_BAR_CONFIG_DIR;
    else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfig;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('ok - performance optimization primitives and background workers');
})().catch((error) => { console.error(error); process.exit(1); });
