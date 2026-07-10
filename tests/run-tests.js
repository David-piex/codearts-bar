'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseStatsOutput } = require('../src/officialStats');
const { buildQuota, dayStartMs, nextDayStartMs } = require('../src/quota');
const { buildHealth, notificationEvents } = require('../src/health');
const { listProviders } = require('../src/providers');
const localProvider = require('../src/providers/codeartsLocal');
const agg = require('../src/core/aggregator');
const cacheMetrics = require('../src/core/cacheMetrics');
const { getSnapshotAsync } = require('../src/codeartsData');
const rollupCache = require('../src/providers/codearts/rollup-cache');
const dashboardUsageRollup = require('../src/providers/codearts/usage-rollup');
const usageRollupCalc = require('../src/providers/codearts/usage-rollup-calc');
const aggregationRuntime = require('../src/providers/codearts/aggregation-runtime');

function testOfficialStatsParser() {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'codearts-stats.txt'), 'utf8');
  const parsed = parseStatsOutput(text);
  assert.equal(parsed.sessions, 1);
  assert.equal(parsed.messages, 2);
  assert.equal(parsed.input, 20900);
  assert.equal(parsed.output, 10);
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].name, 'huaweicloud-maas/gpt-5.5');
}
function testQuota() {
  const timestamp = new Date('2026-07-07T06:00:00Z').getTime();
  const snap = { timestamp, config: { dailyLimit: 1000, windowHours: 24 }, usage: { today: { total: 400 }, window: { total: 500 }, week: { total: 2500 } } };
  const q = buildQuota(snap);
  assert.equal(q.primary.id, 'daily');
  assert.equal(q.primary.remaining, 600);
  assert.equal(q.primary.percent, 40);
  assert.ok(q.primary.resetAt > timestamp);
  assert.equal(dayStartMs(timestamp) < timestamp, true);
  assert.equal(nextDayStartMs(timestamp) > timestamp, true);
}
function testProviders() {
  const ids = listProviders().map((p) => p.id);
  assert.deepEqual(ids, ['codearts-local', 'codearts-official', 'codearts-desktop']);
  assert.equal(typeof localProvider.collectRows, 'function');
  assert.equal(typeof localProvider.scanTtftLogs, 'function');
  assert.equal(typeof localProvider.aggregateCacheStats, 'function');
  assert.equal(typeof localProvider.usageRollupStats, 'function');
}
function testAggregator() {
  const base = Date.UTC(2026, 6, 7, 1, 0, 0);
  const rows = [{ id:'m1', session_id:'s1', time_created:base, time_updated:base+1000, data: JSON.stringify({ role:'assistant', modelID:'m', providerID:'p', time:{ created:base, completed:base+1000 }, tokens:{ input:1, output:2, total:3 } }) }];
  const parts = [{ id:'p1', message_id:'m1', session_id:'s1', time_created:base+100, time_updated:base+100, data: JSON.stringify({ type:'tool', tool:'read' }) }];
  assert.equal(agg.sumTokens(rows).total, 3);
  assert.equal(agg.toolStats(parts).byName[0].name, 'read');
  assert.equal(agg.performanceStats(rows, agg.buildPartMap(parts), 0).latency.avg, 1000);
}
function testCacheMetricsFormula() {
  const fixture = { input: 842000, output: 26000, cacheRead: 509000, cacheWrite: 0 };
  assert.equal(cacheMetrics.cacheHitDenominator(fixture), 1351000);
  assert.equal(Math.round(cacheMetrics.cacheHitRatePercent(fixture)), 38);
  assert.equal(cacheMetrics.cacheHitRatePercent({ input: 100, cacheRead: 100, cacheWrite: 100 }), 50);
  assert.equal(cacheMetrics.cacheHitRatePercent({ input: 0, cacheRead: 0, cacheWrite: 100 }), null);
  const usage = agg.sumTokens([
    { id:'a', session_id:'s', time_created:1, time_updated:2, data: JSON.stringify({ role:'assistant', tokens:{ input:100, output:10, cacheRead:100, cacheWrite:100, total:310 } }) },
  ]);
  assert.equal(usage.cacheHitDenominator, 200);
  assert.equal(usage.cacheHitRate, 50);
}
function testCacheMetricPipelineConsistency() {
  const base = Date.UTC(2026, 6, 8, 9, 0, 0);
  const tokenRows = [
    { id: 'cache-a', sessionId: 's-cache', timeCreated: base, timeUpdated: base + 1000, provider: 'p', model: 'm-cache', total: 1377000, input: 842000, output: 26000, reasoning: 0, cacheRead: 509000, cacheWrite: 0, messages: 1, errors: 0, latencyMs: 1200 },
    { id: 'cache-b', sessionId: 's-cache', timeCreated: base + 3600000, timeUpdated: base + 3601000, provider: 'p', model: 'm-cache', total: 310, input: 100, output: 10, reasoning: 0, cacheRead: 100, cacheWrite: 100, messages: 1, errors: 0, latencyMs: 900 },
    { id: 'cache-c', sessionId: 's-cold', timeCreated: base + 7200000, timeUpdated: base + 7201000, provider: 'p', model: 'm-cold', total: 160, input: 120, output: 30, reasoning: 0, cacheRead: 0, cacheWrite: 10, messages: 1, errors: 0, latencyMs: 800 },
  ];
  const expectedDenominator = 842000 + 100 + 120 + 509000 + 100;
  const expectedRate = (509000 + 100) / expectedDenominator * 100;
  const messages = tokenRows.map((row) => ({
    id: row.id,
    session_id: row.sessionId,
    time_created: row.timeCreated,
    time_updated: row.timeUpdated,
    data: JSON.stringify({
      role: 'assistant',
      providerID: row.provider,
      modelID: row.model,
      tokens: {
        input: row.input,
        output: row.output,
        reasoning: row.reasoning,
        cacheRead: row.cacheRead,
        cacheWrite: row.cacheWrite,
        total: row.total,
      },
    }),
  }));

  const core = agg.sumTokens(messages);
  const rollup = usageRollupCalc.sumRows(tokenRows);
  const compact = usageRollupCalc.buildCompactUsageRollup({ id: 'fixture', label: 'Fixture', dbPath: 'cache-fixture.db' }, tokenRows, 3600000);
  const dashboardPart = usageRollupCalc.dashboardPartFromCompactRollup(compact, {
    payload: { range: { start: 0, end: base + 86400000 } },
    windows: { dayStartMs: 0, windowStartMs: 0, weekStartMs: 0 },
    trendRange: { start: 0, end: base + 86400000, bucketMs: 3600000 },
  });
  const modelCache = dashboardPart.modelStats.find((item) => item.model === 'm-cache');
  const firstBucket = dashboardPart.trendBuckets.find((bucket) => bucket.start === base);

  for (const usage of [core, rollup, dashboardPart.summary.usage.all]) {
    assert.equal(usage.cacheHitDenominator, expectedDenominator);
    assert.equal(Math.round(usage.cacheHitRate * 10) / 10, Math.round(expectedRate * 10) / 10);
  }
  assert.equal(firstBucket.cacheHitDenominator, 842000 + 509000);
  assert.equal(Math.round(firstBucket.cacheHitRate), 38);
  assert.equal(modelCache.cacheHitDenominator, 842000 + 100 + 509000 + 100);
  assert.equal(Math.round(modelCache.cacheHitRate * 10) / 10, Math.round(((509000 + 100) / modelCache.cacheHitDenominator) * 1000) / 10);
  assert.notEqual(core.cacheHitRate, (core.cacheRead / Math.max(1, core.cacheRead + core.cacheWrite)) * 100, 'cache hit rate must not use cacheRead/(cacheRead+cacheWrite)');
}
function testRollupSidecarCache() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-rollup-'));
  const previousConfigDir = process.env.CODEARTS_BAR_CONFIG_DIR;
  const dbDir = path.join(tmp, 'db');
  const configDir = path.join(tmp, 'config');
  const dbPath = path.join(dbDir, 'opencode.db');
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(dbPath, 'fixture-v1', 'utf8');
  process.env.CODEARTS_BAR_CONFIG_DIR = configDir;
  try {
    const written = rollupCache.writeRollupCache(dbPath, { summary: { total: 42 }, buckets: [{ total: 42 }] }, {
      kind: 'unit-rollup',
      rowCount: 1,
      generatedAt: 123,
    });
    assert.equal(written.ok, true);
    assert.equal(written.meta.kind, 'unit-rollup');
    assert.equal(written.meta.rowCount, 1);
    assert.equal(written.payload.summary.total, 42);
    assert.equal(fs.readFileSync(written.path, 'utf8').includes('\n'), false);
    assert.ok(path.resolve(written.path).startsWith(path.resolve(configDir)));
    assert.deepEqual(fs.readdirSync(dbDir), ['opencode.db']);

    const read = rollupCache.readRollupCache(dbPath, { kind: 'unit-rollup' });
    assert.equal(read.ok, true);
    assert.equal(read.payload.buckets[0].total, 42);

    fs.appendFileSync(dbPath, 'fixture-v2', 'utf8');
    const stale = rollupCache.readRollupCache(dbPath, { kind: 'unit-rollup' });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'fingerprint-mismatch');

    fs.writeFileSync(rollupCache.rollupCachePath(dbPath, 'unit-rollup'), '{not-json', 'utf8');
    const corrupt = rollupCache.readRollupCache(dbPath, { kind: 'unit-rollup' });
    assert.equal(corrupt.ok, false);
    assert.equal(corrupt.reason, 'corrupt');
  } finally {
    if (previousConfigDir == null) delete process.env.CODEARTS_BAR_CONFIG_DIR;
    else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfigDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function testUsageRollupStats() {
  dashboardUsageRollup.resetUsageRollupStats();
  const previousDisabled = process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
  try {
    process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = '1';
    const disabled = dashboardUsageRollup.scheduleUsageRollupBuild({ id: 'cli', label: 'CLI', dbPath: 'C:\\private\\opencode.db' }, { adapter: 'sql.js' });
    assert.equal(disabled.scheduled, false);
    assert.equal(disabled.reason, 'disabled');
    assert.equal(dashboardUsageRollup.usageRollupStats().skippedDisabled, 1);

    delete process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
    const scheduled = dashboardUsageRollup.scheduleUsageRollupBuild({ id: 'cli', label: 'CLI', dbPath: 'C:\\private\\opencode.db' }, { adapter: 'sql.js', delayMs: 60000 });
    assert.equal(scheduled.scheduled, true);
    const duplicate = dashboardUsageRollup.scheduleUsageRollupBuild({ id: 'cli', label: 'CLI', dbPath: 'C:\\private\\opencode.db' }, { adapter: 'sql.js', delayMs: 60000 });
    assert.equal(duplicate.scheduled, false);
    assert.equal(duplicate.reason, 'pending');
    const stats = dashboardUsageRollup.usageRollupStats();
    assert.equal(stats.pendingCount, 1);
    assert.equal(stats.scheduled, 1);
    assert.equal(stats.skippedPending, 1);
    assert.equal(stats.pending[0].sourceId, 'cli');
    assert.equal(stats.pending[0].adapter, 'sql.js');
    assert.equal(stats.pending[0].dbName, 'opencode.db');
    assert.equal(typeof stats.pending[0].dbHash, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(stats.pending[0], 'dbPath'), false);
  } finally {
    dashboardUsageRollup.resetUsageRollupStats();
    if (previousDisabled == null) delete process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
    else process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = previousDisabled;
  }
}
function testSlowAggregateStats() {
  aggregationRuntime.resetSlowAggregateStats();
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message || ''));
  try {
    const result = aggregationRuntime.timeAggregateSync('summary', 'unit', {
      dbPath: 'C:\\private\\opencode.db',
      slowAggregateMs: 0,
      disableAggregateCache: true,
      range: { start: 1, end: 2 },
    }, () => ({ ok: true, value: 1 }));
    assert.equal(result.ok, true);
    const stats = aggregationRuntime.slowAggregateStats();
    assert.equal(stats.count, 1);
    assert.equal(stats.failed, 0);
    assert.equal(stats.last.label, 'summary');
    assert.equal(stats.last.adapter, 'unit');
    assert.equal(stats.byLabel.summary.count, 1);
    assert.equal(stats.byAdapter.unit.count, 1);
    assert.ok(stats.maxMs >= 0);
    assert.equal(Object.prototype.hasOwnProperty.call(stats.last, 'dbPath'), false);
    assert.doesNotMatch(JSON.stringify(stats), /opencode\.db|C:\\private/);
    assert.ok(warnings.some((line) => line.includes('slow aggregate summary')));
  } finally {
    console.warn = previousWarn;
    aggregationRuntime.resetSlowAggregateStats();
  }
}
function testMultiTurnSessionTokensPreferStepFinish() {
  const base = Date.UTC(2026, 6, 7, 1, 0, 0);
  const rows = [
    { id:'u1', session_id:'s1', source:'desktop', time_created:base, time_updated:base, data: JSON.stringify({ role:'user' }) },
    { id:'a1', session_id:'s1', source:'desktop', time_created:base+1000, time_updated:base+2000, data: JSON.stringify({ role:'assistant', modelID:'m', providerID:'p', time:{ created:base+1000, completed:base+2000 }, tokens:{ input:0, output:0, total:0 } }) },
    { id:'u2', session_id:'s1', source:'desktop', time_created:base+3000, time_updated:base+3000, data: JSON.stringify({ role:'user' }) },
    { id:'a2', session_id:'s1', source:'desktop', time_created:base+4000, time_updated:base+5000, data: JSON.stringify({ role:'assistant', modelID:'m', providerID:'p', time:{ created:base+4000, completed:base+5000 }, tokens:{ input:0, output:0, total:0 } }) },
  ];
  const parts = [
    { id:'p1', message_id:'a1', session_id:'s1', time_created:base+2000, time_updated:base+2000, data: JSON.stringify({ type:'step-finish', tokens:{ input:10, output:5, total:15 } }) },
    { id:'p2', message_id:'a2', session_id:'s1', time_created:base+5000, time_updated:base+5000, data: JSON.stringify({ type:'step-finish', tokens:{ input:20, output:7, reasoning:3, cache:{ read:4, write:1 }, total:35 } }) },
  ];
  const partMap = agg.buildPartMap(parts);
  assert.equal(agg.sumTokens(rows, partMap).total, 50);
  const usage = agg.buildSessionUsageMap(rows, partMap).get('desktop:s1');
  assert.equal(usage.total, 50);
  assert.equal(usage.userTurns, 2);
  assert.equal(usage.modelCalls, 2);
  assert.equal(usage.topModel.model, 'm');
}
function testTtftLogFixture() {
  const events = localProvider.scanTtftLogs(path.join(__dirname, 'fixtures', 'logs'));
  assert.equal(events.length, 2);
  assert.equal(events[0].sessionId, 'ses_fixture');
  assert.equal(events[0].ttftMs, 1234);
  const msg = { id:'msg_fixture', session_id:'ses_fixture', time_created:1783386000000, time_updated:1783386005000, data: JSON.stringify({ role:'assistant', time:{ created:1783386000000, completed:1783386005000 } }) };
  const map = agg.buildTtftMap([msg], events);
  assert.equal(map.get('msg_fixture').ttftMs, 1234);
}
function testQueueLogFixture() {
  const events = localProvider.scanQueueLogs(path.join(__dirname, 'fixtures', 'logs'));
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, 'ses_queue');
  assert.equal(events[0].model, 'GLM-5.1');
  assert.equal(events[0].durationMs, 21000);
  const stats = agg.queueStats(events, 0);
  assert.equal(stats.samples, 1);
  assert.equal(stats.avg, 21000);
  assert.equal(stats.byModel[0].queueLengthMax, 4);
  const trends = agg.buildQueueTrends(events, events[0].end + 60 * 60 * 1000);
  assert.equal(trends.hourly24h.length, 1);
  assert.equal(trends.hourly24h[0].queue, 21000);
}
function testErrorBalanceFixture() {
  const data = { error: { name:'ProviderError', data:{ statusCode:402, message:'剩余额度：$0.011004，需要预扣费额度：$0.065306' } }, role:'assistant', modelID:'m' };
  const error = agg.extractError(data);
  assert.equal(error.statusCode, 402);
  assert.equal(error.balance, 0.011004);
  assert.equal(error.required, 0.065306);
  assert.equal(agg.inferBalance([{ ...error, time: 1 }]).value, 0.011004);
}
function testHealth() {
  const snap = { ok: true, quota: { primary: { percent: 95 } }, performance: { window: { samples: 10, errorRate: 0.1, ttft: { p95: 6000 }, latency: { p95: 30000 } } }, officialUsage: { ok: true }, balance: null };
  const h = buildHealth(snap, { ttftWarnMs: 5000 });
  assert.equal(h.level, 'danger');
  assert.ok(h.issues.some((i) => i.code === 'quota_danger'));
  assert.ok(h.issues.some((i) => i.code === 'ttft_high'));
  assert.equal(notificationEvents({ issues: [] }, h).length >= 2, true);
  const oldBalance = buildHealth({ ok: true, quota: { primary: { percent: 10 } }, performance: { window: { samples: 1, errorRate: 0, ttft: {}, latency: {} } }, officialUsage: { ok: true }, balance: { value: 0.01, time: Date.now() - 3 * 86400000 } }, {});
  assert.equal(oldBalance.level, 'ok');
}

async function testRenameSessionFixture() {
  const sourceDb = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-test-'));
  const dbPath = path.join(tmpDir, 'opencode-fixture.db');
  fs.copyFileSync(sourceDb, dbPath);
  try {
    const result = await localProvider.renameSession({ dbPath, id: 'ses_multi', title: 'Renamed session' });
    assert.equal(result.ok, true);
    const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
    process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
    try {
      const snap = await getSnapshotAsync({ dbPath, dailyLimit: 1000, windowHours: 24 });
      const renamed = snap.sessions.find((session) => session.id === 'ses_multi');
      assert.equal(renamed.title, 'Renamed session');
    } finally {
      if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSqliteFixtureSqlJsFallback() {
  const dbPath = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
  process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
  try {
    const snap = await getSnapshotAsync({ dbPath, dailyLimit: 1000, windowHours: 24 });
    assert.equal(snap.adapter, 'sql.js');
    assert.equal(snap.usage.all.total, 220);
    assert.equal(snap.models[0].model, 'fixture-model');
    assert.equal(snap.tools.all.byName[0].name, 'read');
    const multi = snap.sessions.find((s) => s.id === 'ses_multi');
    assert.equal(multi.usage.total, 53);
    assert.equal(multi.usage.userTurns, 2);
    assert.equal(multi.usage.modelCalls, 2);
    assert.ok(snap.quota.primary.resetAt);
  } finally {
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
  }
}

async function testProviderDbPagination() {
  const dbPath = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
  process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
  try {
    const reqPage = await localProvider.getRequestsPage({ dbPath, limit: 1, offset: 0, source: 'all', query: 'multi-model' });
    assert.equal(reqPage.ok, true);
    assert.equal(reqPage.items.length, 1);
    assert.equal(reqPage.total, 2);
    assert.equal(reqPage.items[0].model, 'multi-model');
    assert.equal(reqPage.hasMore, true);
    const reqPage2 = await localProvider.getRequestsPage({ dbPath, limit: 1, offset: 1, source: 'all', query: 'multi-model' });
    assert.equal(reqPage2.items.length, 1);
    assert.notEqual(reqPage2.items[0].id, reqPage.items[0].id);
    const sessionReqPage = await localProvider.getSessionRequestsPage({ dbPath, sessionId: 'ses_multi', limit: 1, offset: 0, source: 'all' });
    assert.equal(sessionReqPage.ok, true);
    assert.equal(sessionReqPage.total, 2);
    assert.equal(sessionReqPage.items.length, 1);
    assert.equal(sessionReqPage.items[0].sessionId, 'ses_multi');
    assert.equal(sessionReqPage.items[0].model, 'multi-model');
    assert.equal(sessionReqPage.hasMore, true);
    const sessionReqPage2 = await localProvider.getSessionRequestsPage({ dbPath, sessionId: 'ses_multi', limit: 1, offset: 1, source: 'all' });
    assert.equal(sessionReqPage2.items.length, 1);
    assert.notEqual(sessionReqPage2.items[0].id, sessionReqPage.items[0].id);

    const sessionPage = await localProvider.getSessionsPage({ dbPath, limit: 1, offset: 0, source: 'all', status: 'active', query: 'Multi' });
    assert.equal(sessionPage.ok, true);
    assert.equal(sessionPage.items.length, 1);
    assert.equal(sessionPage.total, 1);
    assert.equal(sessionPage.items[0].id, 'ses_multi');
    assert.equal(sessionPage.items[0].usage.total, 53);
    assert.equal(sessionPage.items[0].usage.userTurns, 2);
  } finally {
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
  }
}

async function testProviderDbAggregates() {
  const dbPath = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
  process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
  try {
    const timestamp = Date.UTC(2026, 6, 8, 0, 0, 0);
    const summary = await localProvider.getSummary({ dbPath, timestamp, windowHours: 24 });
    assert.equal(summary.ok, true);
    assert.equal(summary.usage.all.total, 220);
    assert.equal(summary.usage.window.messages, 3);
    assert.equal(summary.usage.all.cacheHitDenominator, 141);
    assert.equal(Math.round(summary.usage.all.cacheHitRate * 10) / 10, 7.8);
    assert.notEqual(summary.usage.all.cacheHitDenominator, summary.usage.all.cacheRead + summary.usage.all.cacheWrite);

    const trend = await localProvider.getTrendBuckets({ dbPath, start: 0, end: Date.UTC(2030, 0, 1), bucketMs: 86400000 });
    assert.equal(trend.ok, true);
    assert.equal(trend.buckets.length, 1);
    assert.equal(trend.buckets[0].total, 220);
    assert.equal(trend.buckets[0].cacheHitDenominator, 141);
    assert.equal(Math.round(trend.buckets[0].cacheHitRate * 10) / 10, 7.8);

    const source = await localProvider.getSourceStats({ dbPath, range: { start: 0, end: Date.UTC(2030, 0, 1) } });
    assert.equal(source.items[0].total, 220);
    assert.equal(source.items[0].requests, 3);
    assert.equal(source.items[0].cacheHitDenominator, 141);
    assert.equal(Math.round(source.items[0].cacheHitRate * 10) / 10, 7.8);

    const models = await localProvider.getModelStats({ dbPath, range: { start: 0, end: Date.UTC(2030, 0, 1) } });
    assert.equal(models.items[0].model, 'fixture-model');
    assert.equal(models.items[0].total, 167);
    assert.equal(models.items[0].cacheHitDenominator, 105);
    assert.equal(Math.round(models.items[0].cacheHitRate * 10) / 10, 4.8);

    const sessions = await localProvider.getSessionSummary({ dbPath, timestamp });
    assert.equal(sessions.total, 2);
    assert.equal(sessions.active, 2);

    const health = await localProvider.getDatabaseHealth({ dbPath });
    assert.equal(health.items[0].quickCheck, 'ok');
    assert.equal(health.items[0].messageCount, 5);
  } finally {
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
  }
}

async function testDashboardUsageRollupCache() {
  const sourceDb = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-dashboard-rollup-'));
  const dbPath = path.join(tmpDir, 'opencode-fixture.db');
  const previousForce = process.env.CODEARTS_BAR_FORCE_SQLJS;
  const previousConfigDir = process.env.CODEARTS_BAR_CONFIG_DIR;
  const previousDisableRollupBuild = process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
  fs.copyFileSync(sourceDb, dbPath);
  process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
  process.env.CODEARTS_BAR_CONFIG_DIR = path.join(tmpDir, 'config');
  process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = '1';
  try {
    const payload = {
      dbPath,
      timestamp: Date.UTC(2026, 6, 8, 0, 0, 0),
      range: { start: 0, end: Date.UTC(2030, 0, 1) },
      bucketMs: 86400000,
      disableAggregateCache: true,
    };
    const first = await localProvider.getDashboardAggregates(payload);
    assert.equal(first.ok, true);
    assert.equal(first.usage.all.total, 220);
    assert.equal(first.perf.usageRollup.statuses[0].status, 'miss-pass-through');

    const built = await dashboardUsageRollup.buildAndWriteUsageRollupForSource({ id: 'custom', label: 'Custom', dbPath }, { adapter: 'sql.js' });
    assert.equal(built.usageRollup.status, 'miss');
    assert.equal(built.usageRollup.rowCount, 3);
    const buildStats = dashboardUsageRollup.usageRollupStats();
    assert.equal(buildStats.buildRuns, 1);
    assert.equal(buildStats.recentBuilds.length, 1);
    assert.equal(buildStats.recentBuilds[0].adapter, 'sql.js');
    assert.equal(buildStats.recentBuilds[0].dbName, 'opencode-fixture.db');
    assert.equal(typeof buildStats.recentBuilds[0].dbHash, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(buildStats.recentBuilds[0], 'dbPath'), false);
    assert.ok(Number(buildStats.lastBuildMs) >= 0);

    const second = await localProvider.getDashboardAggregates(payload);
    assert.equal(second.ok, true);
    assert.equal(second.usage.all.total, first.usage.all.total);
    assert.equal(second.buckets[0].total, first.buckets[0].total);
    assert.equal(second.modelStats[0].total, first.modelStats[0].total);
    assert.equal(second.perf.usageRollup.hits, 1);
    assert.equal(second.perf.usageRollup.compactHits, 1);
    assert.equal(second.perf.usageRollup.statuses[0].status, 'compact-hit');
    assert.equal(second.perf.usageRollup.statuses[0].sessionStatus, 'session-hit');
    assert.equal(second.sessionSummary.total, first.sessionSummary.total);
    assert.ok(second.perf.usageRollup.statuses[0].compactBuckets >= 1);

    const summaryFast = await localProvider.getSummary(payload);
    assert.equal(summaryFast.ok, true);
    assert.equal(summaryFast.usage.all.total, first.usage.all.total);
    assert.equal(summaryFast.perf.usageRollup.compactHits, 1);

    const trendFast = await localProvider.getTrendBuckets(payload);
    assert.equal(trendFast.ok, true);
    assert.equal(trendFast.buckets[0].total, first.buckets[0].total);
    assert.equal(trendFast.perf.usageRollup.compactHits, 1);

    const sourceFast = await localProvider.getSourceStats(payload);
    assert.equal(sourceFast.ok, true);
    assert.equal(sourceFast.items[0].total, first.sourceStats[0].total);
    assert.equal(sourceFast.perf.usageRollup.compactHits, 1);

    const modelFast = await localProvider.getModelStats(payload);
    assert.equal(modelFast.ok, true);
    assert.equal(modelFast.items[0].total, first.modelStats[0].total);
    assert.equal(modelFast.perf.usageRollup.compactHits, 1);

    const sessionFast = await localProvider.getSessionSummary(payload);
    assert.equal(sessionFast.ok, true);
    assert.equal(sessionFast.total, first.sessionSummary.total);
    assert.equal(sessionFast.perf.usageRollup.sessionHits, 1);
  } finally {
    if (previousForce == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previousForce;
    if (previousConfigDir == null) delete process.env.CODEARTS_BAR_CONFIG_DIR; else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfigDir;
    if (previousDisableRollupBuild == null) delete process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD; else process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = previousDisableRollupBuild;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

(async () => {
  testOfficialStatsParser();
  testQuota();
  testProviders();
  testAggregator();
  testCacheMetricsFormula();
  testCacheMetricPipelineConsistency();
  testRollupSidecarCache();
  testUsageRollupStats();
  testSlowAggregateStats();
  testMultiTurnSessionTokensPreferStepFinish();
  testTtftLogFixture();
  testQueueLogFixture();
  testErrorBalanceFixture();
  testHealth();
  await testSqliteFixtureSqlJsFallback();
  await testProviderDbPagination();
  await testProviderDbAggregates();
  await testDashboardUsageRollupCache();
  await testRenameSessionFixture();
  console.log('ok - unit tests');
})().catch((error) => { console.error(error); process.exit(1); });
