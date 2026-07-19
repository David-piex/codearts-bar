'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const aggregation = require('../src/providers/codearts/aggregation');
const rollup = require('../src/providers/codearts/usage-rollup');
const rollupState = require('../src/providers/codearts/rollup-state');

function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) { return reject(error); }
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('timed out waiting for rollup state'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-rollup-recovery-'));
  const previousConfig = process.env.CODEARTS_BAR_CONFIG_DIR;
  const dbPath = path.join(temp, 'private-user-database.db');
  const sqlJsDbPath = path.join(temp, 'private-sqljs-database.db');
  const source = { id: 'custom', label: 'Custom', dbPath };
  try {
    process.env.CODEARTS_BAR_CONFIG_DIR = path.join(temp, 'config');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'opencode-fixture.db'), dbPath);
    rollup.resetUsageRollupStats();

    const direct = await aggregation.getDashboardAggregates({
      dbPath,
      useSavedSettings: false,
      timestamp: Date.UTC(2026, 6, 8, 12),
      bucketMs: 3600000,
    });
    assert.equal(direct.ok, true, 'rollup miss must return a successful direct SQL response');
    assert.ok(Number(direct.usage?.all?.messages || 0) > 0, 'direct SQL fallback must retain complete usage data');
    assert.equal(direct.rollupState?.fallback, 'direct-sql');
    assert.ok(['queued', 'running'].includes(direct.rollupState?.status));
    rollup.resetUsageRollupStats();

    let finishOldBuild;
    let oldBuildStarted = false;
    rollup.scheduleUsageRollupBuild(source, {
      delayMs: 0,
      buildTask: () => new Promise((resolve) => {
        oldBuildStarted = true;
        finishOldBuild = resolve;
      }),
    });
    await waitFor(() => oldBuildStarted);
    rollup.resetUsageRollupStats();

    let finishCurrentBuild;
    let currentBuildStarted = false;
    rollup.scheduleUsageRollupBuild(source, {
      delayMs: 0,
      buildTask: () => new Promise((resolve) => {
        currentBuildStarted = true;
        finishCurrentBuild = resolve;
      }),
    });
    await waitFor(() => currentBuildStarted);
    finishOldBuild({ usageRollup: { status: 'rebuilt', rowCount: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(rollup.usageRollupStats().pendingCount, 1, 'a stale completion must not remove the current generation pending build');
    finishCurrentBuild({ usageRollup: { status: 'rebuilt', rowCount: 1 } });
    await waitFor(() => rollup.usageRollupStats().pendingCount === 0);
    assert.equal(rollup.usageRollupStats().buildCompleted, 1, 'only the current generation completion should update stats');
    rollup.resetUsageRollupStats();

    let calls = 0;
    const observed = [];
    rollup.setUsageRollupStateListener((state) => observed.push(state));
    const scheduled = rollup.scheduleUsageRollupBuild(source, {
      adapter: 'node:sqlite', delayMs: 0, retryDelayMs: 20, maxAttempts: 2, fallback: 'direct-sql',
      buildTask: async (_source, { attempt, onProgress }) => {
        calls += 1;
        onProgress({ phase: 'scanning', percent: 30, scannedRows: 3, totalRows: 10 });
        if (attempt === 1) throw new Error(`${dbPath} simulated first build failure`);
        onProgress({ phase: 'enriching', percent: 70, scannedRows: 8, totalRows: 10 });
        return { usageRollup: { status: 'rebuilt', rowCount: 10 } };
      },
    });
    assert.equal(scheduled.scheduled, true);

    await waitFor(() => observed.find((state) => state.status === 'retrying'));
    const ready = await waitFor(() => {
      const state = rollupState.readRollupState(source);
      return state?.status === 'ready' ? state : null;
    });
    assert.equal(calls, 2, 'failed first build must retry exactly once before recovery');
    assert.equal(ready.percent, 100);
    assert.equal(ready.fallback, null);
    assert.ok(observed.some((state) => state.phase === 'scanning' && state.scannedRows === 3));
    assert.ok(observed.some((state) => state.phase === 'enriching' && state.scannedRows === 8));
    assert.ok(observed.some((state) => state.status === 'retrying' && state.fallback === 'direct-sql'));
    const stats = rollup.usageRollupStats();
    assert.equal(stats.buildRetries, 1);
    assert.equal(stats.buildRecovered, 1);

    const escaped = dbPath.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    assert.doesNotMatch(fs.readFileSync(rollupState.statePath(dbPath), 'utf8'), new RegExp(escaped));
    assert.doesNotMatch(JSON.stringify(observed), new RegExp(escaped));

    rollup.resetUsageRollupStats();
    observed.length = 0;
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'opencode-fixture.db'), sqlJsDbPath);
    const sqlJsSource = { id: 'custom', label: 'Custom', dbPath: sqlJsDbPath };
    const previousForceSqlJs = process.env.CODEARTS_BAR_FORCE_SQLJS;
    process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
    try {
      const sqlJsDirect = await aggregation.getDashboardAggregates({
        dbPath: sqlJsDbPath, useSavedSettings: false,
        timestamp: Date.UTC(2026, 6, 8, 12), bucketMs: 3600000,
      });
      assert.equal(sqlJsDirect.ok, true);
      assert.ok(Number(sqlJsDirect.usage?.all?.messages || 0) > 0);
      assert.equal(sqlJsDirect.rollupState?.fallback, 'direct-sql');
      const sqlJsReady = await waitFor(() => {
        const state = rollupState.readRollupState(sqlJsSource);
        return state?.status === 'ready' ? state : null;
      }, 30000);
      assert.equal(sqlJsReady.adapter, 'sql.js');
      assert.equal(sqlJsReady.percent, 100);
      assert.ok(observed.some((state) => state.adapter === 'sql.js' && state.phase === 'scanning'));
    } finally {
      if (previousForceSqlJs == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS;
      else process.env.CODEARTS_BAR_FORCE_SQLJS = previousForceSqlJs;
    }
    console.log('ok - rollup progress direct SQL fallback retry and background recovery');
  } finally {
    rollup.setUsageRollupStateListener(null);
    rollup.resetUsageRollupStats();
    if (previousConfig == null) delete process.env.CODEARTS_BAR_CONFIG_DIR;
    else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfig;
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
