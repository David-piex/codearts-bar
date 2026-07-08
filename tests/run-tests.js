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
const { getSnapshotAsync } = require('../src/codeartsData');

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
}
function testAggregator() {
  const base = Date.UTC(2026, 6, 7, 1, 0, 0);
  const rows = [{ id:'m1', session_id:'s1', time_created:base, time_updated:base+1000, data: JSON.stringify({ role:'assistant', modelID:'m', providerID:'p', time:{ created:base, completed:base+1000 }, tokens:{ input:1, output:2, total:3 } }) }];
  const parts = [{ id:'p1', message_id:'m1', session_id:'s1', time_created:base+100, time_updated:base+100, data: JSON.stringify({ type:'tool', tool:'read' }) }];
  assert.equal(agg.sumTokens(rows).total, 3);
  assert.equal(agg.toolStats(parts).byName[0].name, 'read');
  assert.equal(agg.performanceStats(rows, agg.buildPartMap(parts), 0).latency.avg, 1000);
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

(async () => {
  testOfficialStatsParser();
  testQuota();
  testProviders();
  testAggregator();
  testMultiTurnSessionTokensPreferStepFinish();
  testTtftLogFixture();
  testQueueLogFixture();
  testErrorBalanceFixture();
  testHealth();
  await testSqliteFixtureSqlJsFallback();
  await testRenameSessionFixture();
  console.log('ok - unit tests');
})().catch((error) => { console.error(error); process.exit(1); });
