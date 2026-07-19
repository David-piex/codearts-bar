'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { parseStatsOutput } = require('../src/officialStats');
const { buildQuota, dayStartMs, nextDayStartMs } = require('../src/quota');
const { buildHealth, notificationEvents } = require('../src/health');
const { listProviders } = require('../src/providers');
const localProvider = require('../src/providers/codeartsLocal');
const agg = require('../src/core/aggregator');
const cacheMetrics = require('../src/core/cacheMetrics');
const { getSnapshotAsync, getSnapshotWithCache, errorSnapshot, resolveNow } = require('../src/codeartsData');
const { writeCache, closeSettingsStore } = require('../src/settings');
const rollupCache = require('../src/providers/codearts/rollup-cache');
const dashboardUsageRollup = require('../src/providers/codearts/usage-rollup');
const usageRollupCalc = require('../src/providers/codearts/usage-rollup-calc');
const aggregationRuntime = require('../src/providers/codearts/aggregation-runtime');
const aggregateCache = require('../src/providers/codearts/aggregate-cache');
const atomicFile = require('../src/core/atomic-file');
const sqlite = require('../src/providers/codearts/sqlite');
const sourceQueries = require('../src/providers/codearts/sources');
const { redactSensitiveText } = require('../src/core/sensitive-text');
const { DatabaseSync } = require('node:sqlite');

const FIXTURE_NOW_MS = Date.UTC(2026, 6, 8, 0, 0, 0);

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
function testAtomicRenameRetriesTransientWindowsLocks() {
  const original = fs.renameSync;
  let attempts = 0;
  fs.renameSync = (source, target) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('transient lock'), { code: 'UNKNOWN' });
    return original(source, target);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-atomic-'));
  const source = path.join(tmp, 'source.tmp');
  const target = path.join(tmp, 'target.txt');
  try {
    fs.writeFileSync(source, 'complete', 'utf8');
    atomicFile.renameWithRetry(source, target, { renameAttempts: 2 });
    assert.equal(attempts, 2);
    assert.equal(fs.readFileSync(target, 'utf8'), 'complete');
  } finally {
    fs.renameSync = original;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
async function testExplicitMissingDatabaseDoesNotUseSnapshotCache() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-explicit-db-'));
  const previousConfigDir = process.env.CODEARTS_BAR_CONFIG_DIR;
  const previousDb = process.env.CODEARTS_BAR_DB;
  process.env.CODEARTS_BAR_CONFIG_DIR = path.join(tmp, 'config');
  delete process.env.CODEARTS_BAR_DB;
  closeSettingsStore();
  try {
    writeCache({
      ok: true,
      timestamp: Date.now() - 60_000,
      dbPath: path.join(tmp, 'old.db'),
      usage: { all: { total: 123 } },
      freshness: { stale: false, source: 'live', ageMs: 0 },
    });
    const missingDb = path.join(tmp, 'missing.db');
    await assert.rejects(
      () => getSnapshotWithCache({ dbPath: missingDb }),
      (error) => /不存在|ENOENT|no such file/i.test(String(error?.message || error)),
    );
  } finally {
    closeSettingsStore();
    if (previousConfigDir == null) delete process.env.CODEARTS_BAR_CONFIG_DIR;
    else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfigDir;
    if (previousDb == null) delete process.env.CODEARTS_BAR_DB;
    else process.env.CODEARTS_BAR_DB = previousDb;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  const placeholders = [
    { id:'placeholder', session_id:'s1', time_created:base + 2, time_updated:base + 2, data: JSON.stringify({ role:'assistant', modelID:'m', tokens:{ input:0, output:0 } }) },
    { id:'error-row', session_id:'s1', time_created:base + 3, time_updated:base + 3, data: JSON.stringify({ role:'assistant', modelID:'m', error:{ message:'failed' }, tokens:{ input:0, output:0 } }) },
  ];
  const placeholderUsage = agg.sumTokens(placeholders);
  assert.equal(placeholderUsage.messages, 1, 'zero-token assistant placeholders must be excluded while errors remain visible');
  assert.equal(placeholderUsage.errors, 1);
  const mixedUsage = agg.pickToken({ tokens: { input: 0 }, usage: { input: 12, output: 3, cache_creation_input_tokens: 5 } });
  assert.deepEqual(mixedUsage, { total: 20, input: 12, output: 3, reasoning: 0, cacheRead: 0, cacheWrite: 5 }, 'tokens and usage aliases must share one fallback chain');
  const topLevelUsage = agg.pickToken({ input_tokens: 7, completion_tokens: 2, cached_tokens: 3, cache_creation_input_tokens: 1 });
  assert.deepEqual(topLevelUsage, { total: 13, input: 7, output: 2, reasoning: 0, cacheRead: 3, cacheWrite: 1 }, 'top-level token aliases must match nested token parsing');
  const partOnly = { id:'part-only', session_id:'s1', time_created:base + 4, time_updated:base + 4, data: JSON.stringify({ role:'assistant', modelID:'m', tokens:{ input:0, output:0 } }) };
  const partOnlyMap = agg.buildPartMap([{ id:'finish', message_id:'part-only', session_id:'s1', time_created:base + 5, data:JSON.stringify({ type:'step-finish', tokens:{ input:1, output:1 } }) }]);
  const ttft = agg.buildTtftMap([partOnly], [{ sessionId:'s1', firstTokenAt:base + 5, ttftMs:1 }], partOnlyMap);
  assert.equal(ttft.get('part-only')?.ttftMs, 1, 'step-finish-only assistants must remain eligible for TTFT matching');
  const sessionFilter = sourceQueries.sessionWhere({ model:'m', range:{ start:10, endExclusive:20 } });
  assert.match(sessionFilter.where, /session_message\.time_created >= \?/);
  assert.match(sessionFilter.where, /session_message\.time_created < \?/);
  assert.deepEqual(sessionFilter.params, [10, 20, 'm', 10, 20]);
  const multiSessionFilter = sourceQueries.sessionWhere({ model:['m1', 'm2'], project:['C:/one', '__none'] });
  assert.match(multiSessionFilter.where, /directory in \(\?\)/);
  assert.match(multiSessionFilter.where, /modelID[\s\S]*in \(\?,\?\)/);
  assert.deepEqual(multiSessionFilter.params, ['C:/one', 'm1', 'm2']);
  const multiAssistantFilter = sourceQueries.assistantWhere(
    { model:['m1', 'm2'], project:['C:/one', '__none'] },
    { outerAlias:'message' },
  );
  assert.match(multiAssistantFilter.where, /project_session\.id = message\.session_id/);
  assert.match(multiAssistantFilter.where, /project_session\.directory in \(\?\)/);
  assert.deepEqual(multiAssistantFilter.params, ['assistant', 'm1', 'm2', 'C:/one']);
  assert.equal(sourceQueries.sourceMatchesPayload({ id:'cli' }, { source:['desktop', 'cli'] }), true);
  assert.equal(sourceQueries.sourceMatchesPayload({ id:'custom' }, { source:['desktop', 'cli'] }), false);
  assert.equal(dashboardUsageRollup.canUseSessionSummaryRollup({ model:'m' }), false, 'model-filtered session summaries must bypass unscoped rollups');
  assert.equal(dashboardUsageRollup.canUseScopedSessionSummaryRollup({ model:'m' }), true, 'model-filtered session summaries should use token-scoped rollups');
  assert.equal(dashboardUsageRollup.canUseScopedSessionSummaryRollup({ model:'m', query:'needle' }), false, 'session search must bypass token-scoped rollups');
  assert.equal(dashboardUsageRollup.canUseUsageRollup({ project:'C:/one' }), true, 'project-filtered token analytics should reuse scoped token rollups');
  assert.equal(dashboardUsageRollup.canUseSessionSummaryRollup({ project:['C:/one', 'C:/two'] }), false, 'multi-project session summaries must bypass single-project rollups');
  assert.equal(agg.percentile([10, 20, 30, 40], 95), 40);
  const largeSummary = agg.summarize(Array.from({ length: 150000 }, (_, index) => index));
  assert.equal(largeSummary.min, 0);
  assert.equal(largeSummary.p95, 142499);
  assert.equal(largeSummary.max, 149999);
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
  const latencyRows = Array.from({ length: 20 }, (_, index) => ({
    id: `lat-${index}`,
    sessionId: 'latency-session',
    timeCreated: base + index * 1000,
    provider: 'p95-provider',
    model: 'p95-model',
    total: 1,
    input: 1,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    messages: 1,
    errors: 0,
    latencyMs: index === 19 ? 1000 : index + 1,
  }));
  const latencyTrend = usageRollupCalc.trendBucketsFromRows(latencyRows, { start: base, endExclusive: base + 60000, bucketMs: 60000 });
  assert.equal(latencyTrend[0].latencyP95, 19, 'trend P95 must be percentile, not max');
  const latencyModel = usageRollupCalc.modelStatsFromRows(latencyRows, { id: 'fixture', label: 'Fixture' })[0];
  assert.equal(latencyModel.performance.latency.p50, 10, 'model P50 must use the same percentile contract');
  assert.equal(latencyModel.performance.latency.p95, 19, 'model P95 must be percentile, not max');
  assert.equal(latencyModel.performance.latency.p99, 1000, 'model P99 must use the same percentile contract');
  const splitModels = [latencyRows.slice(0, 10), latencyRows.slice(10)].map((rows, index) => usageRollupCalc.modelStatsFromRows(rows, { id: `source-${index}`, label: `Source ${index}` }));
  const mergedModel = aggregationRuntime.mergeModelStats(splitModels)[0];
  assert.equal(mergedModel.performance?.latency?.p50, 10, 'multi-source model P50 must merge raw rollup samples');
  assert.equal(mergedModel.performance?.latency?.p90, 18, 'multi-source model P90 must merge raw rollup samples');
  assert.equal(mergedModel.performance?.latency?.p95, 19, 'multi-source model P95 must merge raw rollup samples');
  assert.equal(mergedModel.performance?.latency?.p99, 1000, 'multi-source model P99 must merge raw rollup samples');
  const splitBuckets = [latencyRows.slice(0, 10), latencyRows.slice(10)].flatMap((rows) => usageRollupCalc.trendBucketsFromRows(rows, { start: base, endExclusive: base + 60000, bucketMs: 60000 }));
  const mergedBucket = aggregationRuntime.mergeBuckets(splitBuckets, 60000)[0];
  assert.equal(mergedBucket.latencyP95, 19, 'multi-source trend P95 must merge raw rollup samples');
  const compactParts = [latencyRows.slice(0, 10), latencyRows.slice(10)].map((rows, index) => {
    const source = { id: `compact-${index}`, label: `Compact ${index}`, dbPath: `compact-${index}.db` };
    const compactRollup = usageRollupCalc.buildCompactUsageRollup(source, rows, 60000);
    return usageRollupCalc.dashboardPartFromCompactRollup(compactRollup, {
      payload: { range: { start: base, endExclusive: base + 60000 } },
      windows: { dayStartMs: base, windowStartMs: base, weekStartMs: base },
      trendRange: { start: base, endExclusive: base + 60000, bucketMs: 60000 },
    });
  });
  assert.equal(aggregationRuntime.mergeModelStats(compactParts.map((part) => part.modelStats))[0].performance.latency.p95, 19, 'compact rollup model P95 must merge raw samples');
  assert.equal(aggregationRuntime.mergeBuckets(compactParts.flatMap((part) => part.trendBuckets), 60000)[0].latencyP95, 19, 'compact rollup trend P95 must merge raw samples');
}
async function testRuntimeErrorPrivacy() {
  const secretRoot = path.join(os.tmpdir(), 'private-runtime-secret');
  const secretPath = path.join(secretRoot, 'opencode.db');
  const raw = new Error(`EACCES token=secret-value ${secretPath}`);
  const safe = localProvider.safeDbError(raw);
  assert.doesNotMatch(safe, /secret-value|private-runtime-secret|opencode\.db/i);
  assert.match(safe, /权限|数据源/);

  const snapshot = errorSnapshot(raw, secretPath, { timestamp: FIXTURE_NOW_MS });
  assert.doesNotMatch(snapshot.error, /secret-value|private-runtime-secret|opencode\.db/i);

  const page = aggregationRuntime.aggregateError(raw, {});
  assert.doesNotMatch(page.nativeError, /secret-value|private-runtime-secret|opencode\.db/i);

  const missing = path.join(secretRoot, 'missing.db');
  await assert.rejects(
    () => localProvider.collectRows({ dbPath: missing }),
    (error) => {
      assert.match(String(error?.message || error), /不存在/);
      assert.doesNotMatch(String(error?.message || error), /private-runtime-secret|missing\.db/i);
      return true;
    },
  );
  await assert.rejects(
    () => localProvider.getRequestsPage({ dbPath: missing }),
    (error) => {
      assert.match(String(error?.message || error), /不存在/);
      assert.doesNotMatch(String(error?.message || error), /private-runtime-secret|missing\.db/i);
      return true;
    },
  );
}
function testLocalDayTrendBuckets() {
  const day = 86_400_000;
  const shanghaiOffset = 8 * 3_600_000;
  const localMidnight = Date.parse('2026-07-11T16:00:00.000Z');
  const rows = [
    { timeCreated: Date.parse('2026-07-11T16:30:00.000Z'), total: 10, input: 6, output: 4, messages: 1 },
    { timeCreated: Date.parse('2026-07-12T15:30:00.000Z'), total: 20, input: 12, output: 8, messages: 1 },
    { timeCreated: Date.parse('2026-07-12T16:30:00.000Z'), total: 30, input: 18, output: 12, messages: 1 },
  ];
  const endExclusive = rows[2].timeCreated + 1;
  const buckets = usageRollupCalc.trendBucketsFromRows(rows, {
    start: rows[0].timeCreated,
    endExclusive,
    bucketMs: day,
    bucketOffsetMs: shanghaiOffset,
  });
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].start, localMidnight);
  assert.equal(buckets[0].total, 30);
  assert.equal(buckets[1].start, localMidnight + day);
  assert.equal(buckets[1].total, 30);

  const normalized = aggregationRuntime.normalizeTrendRange({
    start: rows[0].timeCreated,
    endExclusive,
    bucketMs: day,
    bucketOffsetMs: shanghaiOffset,
  });
  assert.equal(normalized.bucketOffsetMs, shanghaiOffset);
  const cachePayload = { start: rows[0].timeCreated, endExclusive, bucketMs: day };
  const shanghaiKey = aggregateCache.aggregateCacheKey('trend', 'unit', { ...cachePayload, bucketOffsetMs: shanghaiOffset }, []);
  const utcKey = aggregateCache.aggregateCacheKey('trend', 'unit', { ...cachePayload, bucketOffsetMs: 0 }, []);
  assert.notEqual(shanghaiKey, utcKey);

  const dense = aggregationRuntime.densifyBuckets([buckets[0], buckets[1]], {
    start: localMidnight,
    endExclusive: localMidnight + 4 * day,
    bucketMs: day,
    bucketOffsetMs: shanghaiOffset,
  });
  assert.equal(dense.length, 4);
  assert.equal(dense[0].total, 30);
  assert.equal(dense[1].total, 30);
  assert.equal(dense[2].total, 0);
  assert.equal(dense[3].total, 0);
  assert.equal(dense.reduce((sum, bucket) => sum + bucket.total, 0), 60);

  const tooWide = aggregationRuntime.densifyBuckets(buckets, {
    start: localMidnight,
    endExclusive: localMidnight + 500 * day,
    bucketMs: day,
    bucketOffsetMs: shanghaiOffset,
  });
  assert.equal(tooWide, buckets);
}
function testCalendarDstTrendBuckets() {
  const script = `const r=require('./src/providers/codearts/aggregation-runtime');
const start=Date.parse(process.argv[1]), end=Date.parse(process.argv[2]);
const range=r.normalizeTrendRange({start,end,bucket:'day'});
const items=[{start:start,total:1,messages:1},{start:end-3600000,total:2,messages:1}];
const days=r.densifyBuckets(r.rebucketCalendarDays(items,range),range);
process.stdout.write(JSON.stringify({calendarRebucket:range.calendarRebucket,queryBucketMs:range.queryBucketMs,days:days.length,total:days.reduce((s,x)=>s+x.total,0)}));`;
  const cases = [
    ['Europe/Berlin', '2026-03-27T00:00:00Z', '2026-04-02T00:00:00Z', 3600000],
    ['Australia/Lord_Howe', '2026-04-01T00:00:00Z', '2026-04-10T00:00:00Z', 1800000],
  ];
  for (const [tz, start, end, bucketMs] of cases) {
    const output = execFileSync(process.execPath, ['-e', script, start, end], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.calendarRebucket, true, `${tz} must use calendar rebucketing`);
    assert.equal(result.queryBucketMs, bucketMs, `${tz} must use a transition-safe source bucket`);
    assert.equal(result.total, 3);
    assert.ok(result.days >= 6);
  }
}
function testRollupExclusiveEndBoundaries() {
  const hour = 3_600_000;
  const endExclusive = Date.UTC(2026, 6, 13, 0, 0, 0);
  const rows = [
    { id: 'inside', timeCreated: endExclusive - 1, timeUpdated: endExclusive - 1, total: 7, input: 4, output: 3, messages: 1 },
    { id: 'boundary', timeCreated: endExclusive, timeUpdated: endExclusive, total: 101, input: 100, output: 1, messages: 1 },
  ];
  const filtered = usageRollupCalc.filterRowsForPayload(rows, { range: { start: endExclusive - hour, endExclusive } });
  assert.deepEqual(filtered.map((row) => row.id), ['inside']);
  const trend = usageRollupCalc.trendBucketsFromRows(rows, { start: endExclusive - hour, endExclusive, bucketMs: hour });
  assert.equal(trend.reduce((sum, bucket) => sum + bucket.total, 0), 7);
  const sessions = usageRollupCalc.sessionSummaryPartFromRollup({
    source: { id: 'unit', label: 'Unit' },
    sessions: rows.map((row) => ({ id: row.id, timeUpdated: row.timeUpdated })),
  }, { range: { start: endExclusive - hour, endExclusive }, timestamp: endExclusive });
  assert.equal(sessions.total, 1);
  const unassigned = usageRollupCalc.sessionSummaryPartFromRollup({
    source: { id: 'unit', label: 'Unit' },
    sessions: [
      { id: 'empty', directory: '', timeUpdated: endExclusive - 2 },
      { id: 'spaces', directory: '   ', timeUpdated: endExclusive - 1 },
      { id: 'project', directory: 'C:/project', timeUpdated: endExclusive - 1 },
    ],
  }, { project: '__none', timestamp: endExclusive });
  assert.equal(unassigned.total, 2, 'session rollups must map blank directories to the __none project filter');
  const modelScoped = usageRollupCalc.sessionSummaryPartFromScopedRollups({
    source: { id: 'unit', label: 'Unit' },
    sessions: [
      { id: 's1', directory: 'C:/one', timeUpdated: endExclusive - 2 },
      { id: 's2', directory: 'C:/two', timeUpdated: endExclusive - 1 },
      { id: 's3', directory: 'C:/one', timeUpdated: endExclusive - 1 },
    ],
  }, {
    rows: [
      { sessionId: 's1', model: 'm1', directory: 'C:/one', timeCreated: endExclusive - 2 },
      { sessionId: 's2', model: 'm2', directory: 'C:/two', timeCreated: endExclusive - 1 },
      { sessionId: 's3', model: 'm2', directory: 'C:/one', timeCreated: endExclusive - 1 },
    ],
  }, {
    model: ['m2'],
    project: ['C:/one', 'C:/two'],
    range: { start: endExclusive - hour, endExclusive },
    timestamp: endExclusive,
  });
  assert.equal(modelScoped.total, 2, 'scoped session rollups must retain only sessions matching token model and range filters');
  const compactRows = [
    { start: endExclusive - hour, end: endExclusive, total: 7, messages: 1 },
    { start: endExclusive, end: endExclusive + hour, total: 101, messages: 1 },
  ];
  assert.deepEqual(usageRollupCalc.compactRowsInRange(compactRows, endExclusive - hour, endExclusive).map((row) => row.total), [7]);
  assert.equal(usageRollupCalc.bucketBoundarySafe(endExclusive, endExclusive - 1, endExclusive, 'end', hour), true);
  const dense = aggregationRuntime.densifyBuckets([], { start: endExclusive - 2 * hour, endExclusive, bucketMs: hour, bucketOffsetMs: 0 });
  assert.equal(dense.length, 2);
  assert.equal(dense.at(-1).start, endExclusive - hour);
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
    const staleReadable = rollupCache.readRollupCache(dbPath, { kind: 'unit-rollup', allowFingerprintMismatch: true });
    assert.equal(staleReadable.ok, true);
    assert.equal(staleReadable.meta.stale, true);

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
  const fixtureDbPath = path.join(os.tmpdir(), 'codearts-bar-usage-rollup', 'opencode.db');
  try {
    process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = '1';
    const disabled = dashboardUsageRollup.scheduleUsageRollupBuild({ id: 'cli', label: 'CLI', dbPath: fixtureDbPath }, { adapter: 'sql.js' });
    assert.equal(disabled.scheduled, false);
    assert.equal(disabled.reason, 'disabled');
    assert.equal(dashboardUsageRollup.usageRollupStats().skippedDisabled, 1);

    delete process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
    const scheduled = dashboardUsageRollup.scheduleUsageRollupBuild({ id: 'cli', label: 'CLI', dbPath: fixtureDbPath }, { adapter: 'sql.js', delayMs: 60000 });
    assert.equal(scheduled.scheduled, true);
    const duplicate = dashboardUsageRollup.scheduleUsageRollupBuild({ id: 'cli', label: 'CLI', dbPath: fixtureDbPath }, { adapter: 'sql.js', delayMs: 60000 });
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
    const result = await localProvider.renameSession({ dbPath, id: 'ses_multi', title: 'Renamed session', timestamp: FIXTURE_NOW_MS });
    assert.equal(result.ok, true);
    const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
    process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
    try {
      const snap = await getSnapshotAsync({ dbPath, dailyLimit: 1000, windowHours: 24, timestamp: FIXTURE_NOW_MS, disableUsageLogs: true });
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
    const snap = await getSnapshotAsync({ dbPath, dailyLimit: 1000, windowHours: 24, timestamp: FIXTURE_NOW_MS, disableUsageLogs: true });
    assert.equal(snap.adapter, 'sql.js');
    assert.equal(snap.usage.all.total, 220);
    assert.equal(snap.models[0].model, 'fixture-model');
    assert.equal(snap.requestTotal, 3, 'snapshot request total must count meaningful assistant rows');
    assert.equal(snap.requestLogComplete, true, 'small fixture request log is complete');
    assert.equal(snap.requestLogSampled, false);
    assert.equal(snap.modelsScope?.rangeKey, 'all', 'snapshot model stats must declare their all-time scope');
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
    const rangeSession = await localProvider.getSessionsPage({ dbPath, limit: 20, offset: 0, source: 'all', status: 'all', range: { start: 1783386020000, endExclusive: 1783386040000 } });
    assert.equal(rangeSession.items.find((item) => item.id === 'ses_multi')?.usage.total, 35, 'session usage must honor the selected message range');
  } finally {
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
  }
}

async function testProviderDbAggregates() {
  const dbPath = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
  try {
    const timestamp = Date.UTC(2026, 6, 8, 0, 0, 0);
    const summary = await localProvider.getSummary({ dbPath, timestamp, windowHours: 24 });
    assert.equal(summary.ok, true);
    assert.equal(summary.usage.all.total, 220);
    assert.equal(summary.usage.window.messages, 3);
    assert.equal(summary.usage.all.cacheHitDenominator, 141);
    assert.equal(Math.round(summary.usage.all.cacheHitRate * 10) / 10, 7.8);
    assert.notEqual(summary.usage.all.cacheHitDenominator, summary.usage.all.cacheRead + summary.usage.all.cacheWrite);

    const trendPayload = { dbPath, start: 0, end: Date.UTC(2030, 0, 1), bucketMs: 86400000, bucketOffsetMs: 8 * 3600000, disableAggregateCache: true };
    delete process.env.CODEARTS_BAR_FORCE_SQLJS;
    const nativeTrend = await localProvider.getTrendBuckets(trendPayload);
    process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
    const trend = await localProvider.getTrendBuckets(trendPayload);
    assert.equal(trend.ok, true);
    assert.equal(trend.buckets.length, 1);
    assert.equal(trend.buckets[0].start, Date.UTC(2026, 6, 6, 16, 0, 0));
    assert.equal(trend.buckets[0].total, 220);
    assert.equal(trend.buckets[0].cacheHitDenominator, 141);
    assert.equal(Math.round(trend.buckets[0].cacheHitRate * 10) / 10, 7.8);
    assert.deepEqual(nativeTrend.buckets.map(({ start, total }) => ({ start, total })), trend.buckets.map(({ start, total }) => ({ start, total })));

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

    const dashboard = await localProvider.getDashboardAggregates({ dbPath, timestamp, range: { start: 0, end: Date.UTC(2030, 0, 1) }, bucketMs: 86400000, disableAggregateCache: true });
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.modelStats[0].performance.latency.p95, models.items[0].performance.latency.p95);
    assert.equal(JSON.stringify(dashboard).includes('_latencyValues'), false, 'single-source dashboard payload must not expose internal percentile samples');

    const leanDashboard = await localProvider.getDashboardAggregates({
      dbPath,
      timestamp,
      range: { start: 0, end: Date.UTC(2030, 0, 1) },
      bucketMs: 86400000,
      disableAggregateCache: true,
      disableUsageRollup: true,
      includeExtendedPerformance: false,
    });
    assert.equal(leanDashboard.ok, true);
    assert.equal(leanDashboard.usage.all.total, dashboard.usage.all.total, 'lean dashboard must preserve token totals');
    assert.equal(leanDashboard.buckets[0].latencyP95, dashboard.buckets[0].latencyP95, 'lean dashboard must preserve latency percentiles');
    assert.equal(leanDashboard.modelStats[0].performance.firstContentApprox.count, 0, 'lean dashboard should skip part enrichment');
    assert.equal(leanDashboard.modelStats[0].performance.outputTokensPerSec.count, 0, 'lean dashboard should skip derived speed enrichment');

    const health = await localProvider.getDatabaseHealth({ dbPath });
    assert.equal(health.items[0].quickCheck, 'ok');
    assert.equal(health.items[0].messageCount, 5);
  } finally {
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
  }
}

async function testInternalSessionsStayOutOfSessionViews() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-internal-session-'));
  const dbPath = path.join(tmpDir, 'internal-session.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table session (id text primary key, parent_id text, title text, directory text, version text, time_created integer, time_updated integer, time_archived integer);
      create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    `);
    const insertSession = db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?, ?)');
    insertSession.run('main', '', 'Main session', 'C:/project', '1', 1, 10, null);
    insertSession.run('internal', 'main', 'Explore internals (@explore subagent)', 'C:/project', '1', 2, 20, null);
    const insertMessage = db.prepare('insert into message values (?, ?, ?, ?, ?)');
    insertMessage.run('main-message', 'main', 3, 4, JSON.stringify({ role: 'assistant', providerID: 'p', modelID: 'm', time: { created: 3, completed: 4 }, tokens: { total: 2, input: 1, output: 1 } }));
    insertMessage.run('internal-message', 'internal', 5, 6, JSON.stringify({ role: 'assistant', agent: 'explore', mode: 'explore', providerID: 'p', modelID: 'm', time: { created: 5, completed: 6 }, tokens: { total: 3, input: 2, output: 1 } }));
  } finally { db.close(); }
  const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
  const previousConfigDir = process.env.CODEARTS_BAR_CONFIG_DIR;
  process.env.CODEARTS_BAR_CONFIG_DIR = tmpDir;
  try {
    for (const forceSqlJs of [false, true]) {
      if (forceSqlJs) process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
      else delete process.env.CODEARTS_BAR_FORCE_SQLJS;
      const page = await localProvider.getSessionsPage({ dbPath, status: 'all', limit: 20 });
      assert.equal(page.total, 1);
      assert.deepEqual(page.items.map((item) => item.id), ['main']);
      const summary = await localProvider.getSessionSummary({ dbPath, timestamp: 30, disableUsageRollup: true });
      assert.equal(summary.total, 1);
      const snapshot = await getSnapshotAsync({ dbPath, timestamp: 30, fixtureMode: true });
      assert.equal(snapshot.sessionSummary.total, 1);
      assert.deepEqual(snapshot.sessions.map((item) => item.id), ['main']);
      assert.equal(snapshot.usage.all.total, 5, 'internal task usage must remain part of overall analytics');
      const source = { id: 'custom', label: 'Custom', dbPath };
      await dashboardUsageRollup.buildAndWriteUsageRollupForSource(source, { adapter: forceSqlJs ? 'sql.js' : 'node:sqlite' });
      const rollup = dashboardUsageRollup.readSessionSummaryRollupForSource(source);
      assert.equal(rollup.ok, true);
      assert.deepEqual(rollup.sessions.map((item) => item.id), ['main']);
    }
  } finally {
    dashboardUsageRollup.resetUsageRollupStats();
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
    if (previousConfigDir == null) delete process.env.CODEARTS_BAR_CONFIG_DIR; else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfigDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSessionWritesNeverFallBackToSqlJs() {
  const sourceDb = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-write-lock-'));
  const dbPath = path.join(tmpDir, 'opencode-fixture.db');
  fs.copyFileSync(sourceDb, dbPath);
  const lockDb = new DatabaseSync(dbPath);
  try {
    lockDb.exec('begin immediate');
    await assert.rejects(
      () => localProvider.renameSession({
        dbPath,
        id: 'ses_multi',
        title: 'Must not be written by sql.js',
        timestamp: FIXTURE_NOW_MS,
        busyTimeoutMs: 0,
        busyRetryDelaysMs: [0, 0],
      }),
      (error) => error?.code === 'SQLITE_WRITE_BUSY' && error?.attempts === 3 && /未修改数据库/.test(error.message),
    );
    lockDb.exec('rollback');
    const row = lockDb.prepare('select title from session where id = ?').get('ses_multi');
    assert.equal(row.title, 'Multi Turn Session');
    assert.equal(fs.readdirSync(tmpDir).some((name) => name.includes('.bak-')), false);
    const actionsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'codearts', 'session-actions.js'), 'utf8');
    assert.doesNotMatch(actionsSource, /openSqlJsDbReadonly|database\.export|\.bak-/);
  } finally {
    try { lockDb.exec('rollback'); } catch {}
    lockDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testBatchSessionWritesUseOneCoherentMutation() {
  const sourceDb = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-batch-write-'));
  const dbPath = path.join(tmpDir, 'opencode-fixture.db');
  fs.copyFileSync(sourceDb, dbPath);
  try {
    const archived = await localProvider.archiveSessions({
      sessions: [{ id: 'ses_fixture', dbPath }, { id: 'ses_multi', dbPath }],
      archived: true,
      timestamp: FIXTURE_NOW_MS,
    });
    assert.deepEqual(archived, { ok: true, archived: true, count: 2, time: FIXTURE_NOW_MS, attempts: 1, sources: 1 });
    const db = new DatabaseSync(dbPath);
    try {
      const rows = db.prepare('select id, time_archived from session where id in (?, ?) order by id').all('ses_fixture', 'ses_multi');
      assert.deepEqual(rows.map((row) => [row.id, row.time_archived]), [['ses_fixture', FIXTURE_NOW_MS], ['ses_multi', FIXTURE_NOW_MS]]);
    } finally { db.close(); }
    const restored = await localProvider.archiveSessions({
      sessions: [{ id: 'ses_fixture', dbPath }, { id: 'ses_multi', dbPath }],
      archived: false,
      timestamp: FIXTURE_NOW_MS + 1,
    });
    assert.equal(restored.archived, false);
    assert.equal(restored.count, 2);
    await assert.rejects(
      () => localProvider.archiveSessions({
        sessions: [{ id: 'ses_fixture', dbPath }, { id: 'missing-session', dbPath }],
        archived: true,
        timestamp: FIXTURE_NOW_MS + 2,
      }),
      (error) => error?.cause?.code === 'SESSION_NOT_FOUND' || /会话不存在/.test(String(error?.message || error)),
    );
    const rollbackDb = new DatabaseSync(dbPath);
    try {
      const row = rollbackDb.prepare('select time_archived from session where id = ?').get('ses_fixture');
      assert.equal(row.time_archived, null, 'a failed same-database batch must roll back every row');
    } finally { rollbackDb.close(); }
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

async function testSqlJsReadsCommittedWal() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-wal-snapshot-'));
  const dbPath = path.join(tmpDir, 'wal-fixture.db');
  const writer = new DatabaseSync(dbPath);
  let sqlDb;
  try {
    writer.exec(`
      create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
      pragma journal_mode = wal;
      pragma wal_autocheckpoint = 0;
    `);
    writer.prepare('insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)')
      .run('wal-only', 'session-wal', FIXTURE_NOW_MS - 1, FIXTURE_NOW_MS - 1, JSON.stringify({ role: 'assistant', tokens: { total: 17 } }));
    assert.equal(fs.existsSync(`${dbPath}-wal`), true);
    sqlDb = await sqlite.openSqlJsDbReadonly(dbPath);
    const rows = sqlite.sqlJsAll(sqlDb, "select id, json_extract(data, '$.tokens.total') as total from message order by id");
    assert.deepEqual(rows.map((row) => ({ id: row.id, total: row.total })), [{ id: 'wal-only', total: 17 }]);
    assert.throws(() => sqlDb.exec("update message set id = 'mutated'"), (error) => error?.code === 'SQLJS_READONLY');
    assert.throws(() => sqlDb.prepare("delete from message where id = ?"), (error) => error?.code === 'SQLJS_READONLY');
    assert.throws(() => sqlDb.exec("pragma quick_check; update message set id = 'mutated'"), (error) => error?.code === 'SQLJS_READONLY');
    assert.throws(() => sqlDb.export(), (error) => error?.code === 'SQLJS_READONLY');
    assert.equal(writer.prepare('select count(*) as count from message where id = ?').get('wal-only').count, 1);
  } finally {
    sqlite.closeDb(sqlDb);
    writer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testExactJsonFiltersAndExclusiveRange() {
  const sourceDb = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-json-filter-'));
  const dbPath = path.join(tmpDir, 'opencode-fixture.db');
  fs.copyFileSync(sourceDb, dbPath);
  const db = new DatabaseSync(dbPath);
  const boundary = Date.UTC(2026, 6, 8, 0, 0, 0);
  const insert = db.prepare('insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)');
  try {
    insert.run('nested-gpt4', 'ses_multi', boundary - 4, boundary - 3, JSON.stringify({ role: 'assistant', model: { modelID: 'gpt-4' }, tokens: { total: 3 }, error: false }));
    insert.run('exact-gpt4', 'ses_multi', boundary - 3, boundary - 2, JSON.stringify({ role: 'assistant', modelID: 'gpt-4', tokens: { total: 1 }, error: null }));
    insert.run('prefix-gpt4o', 'ses_multi', boundary - 2, boundary - 1, JSON.stringify({ role: 'assistant', modelID: 'gpt-4o', tokens: { total: 2 }, error: { message: 'failed' } }));
    insert.run('boundary-gpt4', 'ses_multi', boundary, boundary, JSON.stringify({ role: 'assistant', model: { modelID: 'gpt-4' }, tokens: { total: 4 }, error: 'failed at boundary' }));
    insert.run('top-level-token-aliases', 'ses_multi', boundary - 5, boundary - 4, JSON.stringify({ role: 'assistant', modelID: 'top-level-model', input_tokens: 5, completion_tokens: 2 }));
    insert.run('not-assistant', 'ses_multi', boundary - 1, boundary - 1, JSON.stringify({ role: 'user', modelID: 'gpt-4', note: { role: 'assistant' }, tokens: { total: 8 }, error: { message: 'ignore' } }));
    insert.run('malformed-json', 'ses_multi', boundary - 1, boundary - 1, '{"role":"assistant",');
    db.prepare('insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)')
      .run('malformed-part', 'exact-gpt4', 'ses_multi', boundary - 2, boundary - 1, '{bad');
  } finally {
    db.close();
  }

  const previous = process.env.CODEARTS_BAR_FORCE_SQLJS;
  try {
    for (const forceSqlJs of [false, true]) {
      if (forceSqlJs) process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
      else delete process.env.CODEARTS_BAR_FORCE_SQLJS;
      const exact = await localProvider.getRequestsPage({
        dbPath,
        source: 'all',
        model: 'gpt-4',
        range: { start: boundary - 10, endExclusive: boundary },
        limit: 20,
      });
      assert.deepEqual(exact.items.map((item) => item.id), ['exact-gpt4', 'nested-gpt4']);
      const errors = await localProvider.getRequestsPage({ dbPath, source: 'all', errorsOnly: true, range: { start: boundary - 10, end: boundary }, limit: 20 });
      assert.deepEqual(errors.items.map((item) => item.id), ['prefix-gpt4o']);
      const successes = await localProvider.getRequestsPage({ dbPath, source: 'all', error: false, range: { start: boundary - 10, end: boundary }, limit: 20 });
      assert.deepEqual(successes.items.map((item) => item.id), ['exact-gpt4', 'nested-gpt4', 'top-level-token-aliases']);
      const aggregate = await localProvider.getSourceStats({
        dbPath,
        source: 'all',
        model: 'gpt-4',
        range: { start: boundary - 10, endExclusive: boundary },
        disableAggregateCache: true,
      });
      assert.equal(aggregate.items[0].requests, 2);
      assert.equal(aggregate.items[0].total, 4);
      assert.equal(aggregate.items[0].errors, 0);
      const topLevelPage = await localProvider.getRequestsPage({ dbPath, source: 'all', model: 'top-level-model', range: { start: boundary - 10, endExclusive: boundary }, limit: 20 });
      assert.deepEqual(topLevelPage.items.map((item) => ({ id: item.id, total: item.total })), [{ id: 'top-level-token-aliases', total: 7 }]);
      const topLevelAggregate = await localProvider.getSourceStats({ dbPath, source: 'all', model: 'top-level-model', range: { start: boundary - 10, endExclusive: boundary }, disableAggregateCache: true });
      assert.equal(topLevelAggregate.items[0].total, 7);
      assert.equal(topLevelAggregate.items[0].requests, 1);
      const modelSessions = await localProvider.getSessionsPage({ dbPath, source: 'all', status: 'all', model: 'gpt-4', limit: 20, offset: 0 });
      assert.ok(modelSessions.items.some((item) => item.id === 'ses_multi'));
      assert.ok(modelSessions.items.every((item) => (item.usage?.models || []).every((model) => model.model === 'gpt-4')));
      assert.ok(modelSessions.items.every((item) => item.usage?.topModel == null || item.usage.topModel.model === 'gpt-4'));
    }
  } finally {
    if (previous == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS;
    else process.env.CODEARTS_BAR_FORCE_SQLJS = previous;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSnapshotClockAndFixtureIsolation() {
  const dbPath = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
  const explicit = FIXTURE_NOW_MS + 1234;
  const originalScanUsageLogs = localProvider.scanUsageLogs;
  const originalDetectProcesses = localProvider.detectProcesses;
  const originalReadCodeArtsConfig = localProvider.readCodeArtsConfig;
  const previousNow = process.env.CODEARTS_BAR_NOW_MS;
  localProvider.scanUsageLogs = () => { throw new Error('real usage logs must not be read in fixture mode'); };
  localProvider.detectProcesses = () => { throw new Error('real process paths must not be read in fixture mode'); };
  localProvider.readCodeArtsConfig = () => { throw new Error('real CodeArts config must not be read in fixture mode'); };
  try {
    const byTimestamp = await getSnapshotAsync({ dbPath, timestamp: explicit, fixtureMode: true });
    assert.equal(byTimestamp.timestamp, explicit);
    assert.equal(byTimestamp.performance.ttftEvents, 0);
    assert.equal(byTimestamp.queue.events, 0);
    assert.deepEqual(byTimestamp.process, {});
    assert.equal(byTimestamp.codeartsConfig.officialQuota.status, 'environment_probes_disabled');
    assert.equal(Object.prototype.hasOwnProperty.call(byTimestamp.codeartsConfig, 'path'), false);
    const byClock = await getSnapshotAsync({ dbPath, clock: { now: () => explicit + 1 }, disableUsageLogs: true, disableEnvironmentProbes: true });
    assert.equal(byClock.timestamp, explicit + 1);
    process.env.CODEARTS_BAR_NOW_MS = String(explicit + 2);
    assert.equal(resolveNow(), explicit + 2);
    assert.equal(localProvider.resolveTimestamp({ timestamp: 0 }), 0);
    const byEnvironment = await getSnapshotAsync({ dbPath, disableUsageLogs: true, disableEnvironmentProbes: true });
    assert.equal(byEnvironment.timestamp, explicit + 2);
  } finally {
    localProvider.scanUsageLogs = originalScanUsageLogs;
    localProvider.detectProcesses = originalDetectProcesses;
    localProvider.readCodeArtsConfig = originalReadCodeArtsConfig;
    if (previousNow == null) delete process.env.CODEARTS_BAR_NOW_MS;
    else process.env.CODEARTS_BAR_NOW_MS = previousNow;
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
  dashboardUsageRollup.resetUsageRollupStats();
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

    const compact = dashboardUsageRollup.readCompactUsageRollupForSource({ id: 'custom', label: 'Custom', dbPath });
    const windows = aggregationRuntime.timeWindows(payload);
    const shanghaiTrend = aggregationRuntime.normalizeTrendRange({ ...payload, bucketOffsetMs: 8 * 3600000 });
    const indiaTrend = aggregationRuntime.normalizeTrendRange({ ...payload, bucketOffsetMs: 5.5 * 3600000 });
    assert.equal(usageRollupCalc.compactRollupIsSafeForDashboard(compact, { payload, windows, trendRange: shanghaiTrend }), true);
    assert.equal(usageRollupCalc.compactRollupIsSafeForDashboard(compact, { payload, windows, trendRange: indiaTrend }), false);

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

    const selectedModels = [...new Set(built.rows.map((row) => row.model))].slice(0, 2);
    const modelPayload = { ...payload, model: selectedModels };
    assert.equal(
      usageRollupCalc.compactRollupIsSafeForDashboard(compact, {
        payload: modelPayload,
        windows,
        trendRange: aggregationRuntime.normalizeTrendRange(modelPayload),
      }),
      true,
    );
    const modelDirect = await localProvider.getDashboardAggregates({
      ...modelPayload,
      disableUsageRollup: true,
    });
    const modelFilteredFast = await localProvider.getDashboardAggregates(modelPayload);
    assert.equal(modelFilteredFast.usage.all.total, modelDirect.usage.all.total);
    assert.deepEqual(modelFilteredFast.buckets.map((row) => row.total), modelDirect.buckets.map((row) => row.total));
    assert.deepEqual(modelFilteredFast.modelStats.map((row) => row.total), modelDirect.modelStats.map((row) => row.total));
    assert.equal(modelFilteredFast.sessionSummary.total, modelDirect.sessionSummary.total);
    assert.equal(modelFilteredFast.perf.usageRollup.compactHits, 1);
    assert.equal(modelFilteredFast.perf.usageRollup.statuses[0].status, 'compact-hit');
    assert.ok(modelFilteredFast.modelStats.every((row) => selectedModels.includes(row.model)));

    const selectedProjects = [...new Set(built.rows.map((row) => row.directory).filter((directory) => directory))].slice(0, 2);
    assert.ok(selectedProjects.length >= 1, 'fixture rollup should retain session project directories');
    const projectPayload = { ...payload, project: selectedProjects };
    assert.equal(
      usageRollupCalc.compactRollupIsSafeForDashboard(compact, {
        payload: projectPayload,
        windows,
        trendRange: aggregationRuntime.normalizeTrendRange(projectPayload),
      }),
      false,
    );
    const projectDirect = await localProvider.getDashboardAggregates({
      ...projectPayload,
      disableUsageRollup: true,
    });
    const projectFast = await localProvider.getDashboardAggregates(projectPayload);
    assert.equal(projectFast.usage.all.total, projectDirect.usage.all.total);
    assert.deepEqual(projectFast.buckets.map((row) => row.total), projectDirect.buckets.map((row) => row.total));
    assert.deepEqual(projectFast.modelStats.map((row) => row.total), projectDirect.modelStats.map((row) => row.total));
    assert.equal(projectFast.sessionSummary.total, projectDirect.sessionSummary.total);
    assert.equal(projectFast.perf.usageRollup.hits, 1);
    assert.equal(projectFast.perf.usageRollup.compactHits, 0);
    assert.equal(projectFast.perf.usageRollup.statuses[0].status, 'hit');

    const movedSessionId = built.rows.find((row) => row.directory)?.sessionId;
    const movedRow = built.rows.find((row) => row.sessionId === movedSessionId);
    const movedDirectory = `${movedRow.directory}-moved`;
    const movedDb = new DatabaseSync(dbPath);
    try {
      movedDb.prepare('update session set directory = ? where id = ?').run(movedDirectory, movedSessionId);
    } finally {
      movedDb.close();
    }
    const afterSessionMove = await dashboardUsageRollup.buildAndWriteUsageRollupForSource({ id: 'custom', label: 'Custom', dbPath }, { adapter: 'sql.js' });
    assert.equal(afterSessionMove.usageRollup.status, 'incremental-rebuilt');
    assert.equal(afterSessionMove.rows.find((row) => row.sessionId === movedSessionId)?.directory, movedDirectory);

    const independentSessionSearch = await localProvider.getDashboardAggregates({
      ...payload,
      sessionQuery: 'Multi',
    });
    assert.equal(independentSessionSearch.usage.all.total, first.usage.all.total, 'session search must not change rollup analytics usage');
    assert.equal(independentSessionSearch.perf.usageRollup.statuses[0].status, 'compact-hit');
    assert.equal(independentSessionSearch.sessionSummary.total, 1, 'sessionQuery must independently filter the session summary');

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

    const deletedId = built.rows[0].id;
    const writable = new DatabaseSync(dbPath);
    try {
      writable.prepare('delete from part where message_id = ?').run(deletedId);
      writable.prepare('delete from message where id = ?').run(deletedId);
    } finally {
      writable.close();
    }
    const afterDelete = await dashboardUsageRollup.buildAndWriteUsageRollupForSource({ id: 'custom', label: 'Custom', dbPath }, { adapter: 'sql.js' });
    assert.equal(afterDelete.usageRollup.status, 'incremental-rebuilt');
    assert.equal(afterDelete.rows.some((row) => row.id === deletedId), false);
    assert.equal(afterDelete.usageRollup.rowCount, built.rows.length - 1);
    assert.ok(dashboardUsageRollup.usageRollupStats().incrementalDeletedRows >= 1);
  } finally {
    if (previousForce == null) delete process.env.CODEARTS_BAR_FORCE_SQLJS; else process.env.CODEARTS_BAR_FORCE_SQLJS = previousForce;
    if (previousConfigDir == null) delete process.env.CODEARTS_BAR_CONFIG_DIR; else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfigDir;
    if (previousDisableRollupBuild == null) delete process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD; else process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = previousDisableRollupBuild;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  testAtomicRenameRetriesTransientWindowsLocks();
  await testExplicitMissingDatabaseDoesNotUseSnapshotCache();
  testOfficialStatsParser();
  testQuota();
  testProviders();
  testAggregator();
  await testRuntimeErrorPrivacy();
  testEmbeddedJsonPrivacy();
  testCacheMetricsFormula();
  testCacheMetricPipelineConsistency();
  testLocalDayTrendBuckets();
  testCalendarDstTrendBuckets();
  testRollupExclusiveEndBoundaries();
  testRollupSidecarCache();
  testUsageRollupStats();
  testSlowAggregateStats();
  testMultiTurnSessionTokensPreferStepFinish();
  testTtftLogFixture();
  testQueueLogFixture();
  testErrorBalanceFixture();
  testHealth();
  await testSqliteFixtureSqlJsFallback();
  await testSqlJsReadsCommittedWal();
  await testSessionWritesNeverFallBackToSqlJs();
  await testBatchSessionWritesUseOneCoherentMutation();
  await testExactJsonFiltersAndExclusiveRange();
  await testSnapshotClockAndFixtureIsolation();
  await testProviderDbPagination();
  await testProviderDbAggregates();
  await testInternalSessionsStayOutOfSessionViews();
  await testDashboardUsageRollupCache();
  await testRenameSessionFixture();
  console.log('ok - unit tests');
}

function testEmbeddedJsonPrivacy() {
  const samples = [
    ['prefix {"token":123456} suffix', '123456'],
    ['payload={"token":"abc\\\"TAIL_SECRET"}', 'TAIL_SECRET'],
    ['before [{"access_token":"array-secret"}] after', 'array-secret'],
  ];
  for (const [sample, secret] of samples) {
    const safe = redactSensitiveText(sample);
    assert.doesNotMatch(safe, new RegExp(secret), `embedded JSON must redact ${secret}`);
    assert.match(safe, /\[redacted\]/);
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { main };
