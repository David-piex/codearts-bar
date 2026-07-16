"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const aggregation = require("../src/providers/codearts/aggregation");
const aggregateCache = require("../src/providers/codearts/aggregate-cache");
const usageRollup = require("../src/providers/codearts/usage-rollup");
const qualityBaseline = require("../quality-baseline.json");

const FULL_SIZES = [10000, 50000, 100000];
const QUICK_SIZES = [1000, 10000];
const MODELS = ["GLM-5.1", "gpt-5.5", "deepseek-v4-flash", "claude-sonnet"];
const PROVIDERS = ["codearts", "huaweicloud-maas"];

function parseSizes() {
  if (process.env.CODEARTS_BAR_AGG_STRESS_SIZES) {
    return process.env.CODEARTS_BAR_AGG_STRESS_SIZES
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 0);
  }
  return process.argv.includes("--full") ? FULL_SIZES : QUICK_SIZES;
}

function loadNativeSqlite() {
  try { return require("node:sqlite"); }
  catch (error) {
    console.log(`skip - aggregation stress requires node:sqlite to create fixtures: ${error.message}`);
    return null;
  }
}

function makeAssistantData(i, created, completed) {
  const input = 240 + (i % 53) * 11;
  const output = 80 + (i % 31) * 7;
  const reasoning = i % 9 === 0 ? 20 + (i % 13) * 3 : 0;
  const cacheRead = i % 4 === 0 ? 0 : 420 + (i % 67) * 13;
  const cacheWrite = i % 11 === 0 ? 0 : 24 + (i % 17) * 5;
  const total = input + output + reasoning + cacheRead + cacheWrite;
  return JSON.stringify({
    role: "assistant",
    providerID: PROVIDERS[i % PROVIDERS.length],
    modelID: MODELS[i % MODELS.length],
    time: { created, completed },
    tokens: { input, output, reasoning, total, cache: { read: cacheRead, write: cacheWrite } },
    error: i % 997 === 0 ? { message: "synthetic stress error", data: { statusCode: 500 } } : undefined,
  });
}

function createFixtureDb(dbPath, messageCount) {
  const sqlite = loadNativeSqlite();
  if (!sqlite) return false;
  const { DatabaseSync } = sqlite;
  const db = new DatabaseSync(dbPath);
  const now = Date.UTC(2026, 6, 9, 12, 0, 0);
  const sessionCount = Math.max(1, Math.ceil(messageCount / 8));
  try {
    db.exec(`
      pragma journal_mode = off;
      pragma synchronous = off;
      create table session (
        id text primary key,
        title text,
        directory text,
        version text,
        time_created integer,
        time_updated integer,
        time_archived integer
      );
      create table message (
        id text primary key,
        session_id text,
        time_created integer,
        time_updated integer,
        data text
      );
      create table part (
        id text primary key,
        message_id text,
        session_id text,
        time_created integer,
        time_updated integer,
        data text
      );
      create index idx_message_time on message(time_created);
      create index idx_message_session on message(session_id);
      create index idx_session_time on session(time_updated);
      create index idx_part_message on part(message_id);
    `);
  const insertSession = db.prepare("insert into session(id,title,directory,version,time_created,time_updated,time_archived) values(?,?,?,?,?,?,?)");
  const insertMessage = db.prepare("insert into message(id,session_id,time_created,time_updated,data) values(?,?,?,?,?)");
  const insertPart = db.prepare("insert into part(id,message_id,session_id,time_created,time_updated,data) values(?,?,?,?,?,?)");
    db.exec("begin");
    for (let i = 0; i < sessionCount; i += 1) {
      const updated = now - (i % 720) * 60000;
      insertSession.run(`s-${i}`, `压力会话 ${i}`, `C:/stress/project-${i % 64}`, "1", updated - 86400000, updated, i % 23 === 0 ? updated + 60000 : null);
    }
    for (let i = 0; i < messageCount; i += 1) {
      const sessionId = `s-${i % sessionCount}`;
      const created = now - (i % (24 * 14 * 6)) * 10 * 60000;
      const completed = created + 400 + (i % 120) * 25;
      insertMessage.run(`m-${i}`, sessionId, created, completed, makeAssistantData(i, created, completed));
      if (i % 5 === 0) {
        insertPart.run(`p-${i}`, `m-${i}`, sessionId, created + 120, completed, JSON.stringify({
          type: "step-finish",
          tokens: {
            input: 260 + (i % 37) * 9,
            output: 90 + (i % 23) * 8,
            reasoning: i % 10 === 0 ? 40 : 0,
            cache: { read: 500 + (i % 41) * 17, write: 40 + (i % 13) * 5 },
          },
        }));
      }
    }
    db.exec("commit");
  } catch (error) {
    try { db.exec("rollback"); } catch {}
    throw error;
  } finally {
    db.close();
  }
  return true;
}

async function measure(label, fn) {
  const started = performance.now();
  const value = await fn();
  const ms = performance.now() - started;
  return { label, ms, value };
}

async function runRuntime(runtime, dbPath, payload, options = {}) {
  const expectRollup = options.expectRollup === true;
  const api = runtime === "native" ? {
    summary: aggregation.getSummaryNative,
    trend: aggregation.getTrendBucketsNative,
    modelStats: aggregation.getModelStatsNative,
    sessionSummary: aggregation.getSessionSummaryNative,
    dashboard: aggregation.getDashboardAggregatesNative,
  } : {
    summary: aggregation.getSummarySqlJs,
    trend: aggregation.getTrendBucketsSqlJs,
    modelStats: aggregation.getModelStatsSqlJs,
    sessionSummary: aggregation.getSessionSummarySqlJs,
    dashboard: aggregation.getDashboardAggregatesSqlJs,
  };
  const timed = [];
  timed.push(await measure("summary", () => api.summary(payload)));
  timed.push(await measure("trend", () => api.trend(payload)));
  timed.push(await measure("modelStats", () => api.modelStats(payload)));
  timed.push(await measure("sessionSummary", () => api.sessionSummary(payload)));
  timed.push(await measure("dashboardBundle", () => api.dashboard(payload)));

  const summary = timed.find((x) => x.label === "summary").value;
  const sessionSummary = timed.find((x) => x.label === "sessionSummary").value;
  const modelStats = timed.find((x) => x.label === "modelStats").value;
  const trend = timed.find((x) => x.label === "trend").value;
  const dashboard = timed.find((x) => x.label === "dashboardBundle").value;
  const dashboardCached = await api.dashboard(payload);
  assert.ok(summary.ok, `${runtime} summary should be ok for ${dbPath}`);
  if (runtime === 'sql.js') assert.equal(summary.perf?.aggregateWorker?.thread, 'worker', 'sql.js aggregation should execute in a Worker Thread');
  assert.ok((summary.usage?.all?.messages || 0) > 0, `${runtime} summary should count messages`);
  assert.ok((sessionSummary.total || 0) > 0, `${runtime} session summary should count sessions`);
  assert.ok((modelStats.items || []).length > 0, `${runtime} model stats should not be empty`);
  assert.ok((trend.buckets || []).length > 0, `${runtime} trend buckets should not be empty`);
  if (expectRollup) {
    assert.ok(summary.perf?.usageRollup?.hits >= 1, `${runtime} summary should use sidecar rollup hot path`);
    assert.ok(trend.perf?.usageRollup?.hits >= 1, `${runtime} trend should use sidecar rollup hot path`);
    assert.ok(modelStats.perf?.usageRollup?.hits >= 1, `${runtime} model stats should use sidecar rollup hot path`);
    assert.ok(sessionSummary.perf?.usageRollup?.sessionHits >= 1, `${runtime} session summary should use sidecar rollup hot path`);
  }
  assert.equal(dashboard.usage?.all?.messages, summary.usage?.all?.messages, `${runtime} bundle summary should match standalone summary`);
  assert.equal(dashboard.sessionSummary?.total, sessionSummary.total, `${runtime} bundle session summary should match standalone session summary`);
  assert.equal((dashboard.modelStats || []).length, (modelStats.items || []).length, `${runtime} bundle model stats should match standalone model count`);
  assert.equal((dashboard.buckets || []).length, (trend.buckets || []).length, `${runtime} bundle trend should match standalone bucket count`);
  assert.equal(dashboard.perf?.usageRollup?.enabled, true, `${runtime} dashboard bundle should use usage rollup when filters allow it`);
  if (expectRollup) assert.ok(dashboard.perf?.usageRollup?.hits >= 1, `${runtime} dashboard bundle should use sidecar rollup hot path`);
  assert.equal(dashboardCached.usage?.all?.messages, dashboard.usage?.all?.messages, `${runtime} cached bundle summary should match`);
  assert.equal(dashboardCached.perf?.aggregateCache?.hit, true, `${runtime} second dashboard bundle should hit aggregate cache`);
  return {
    runtime,
    timings: Object.fromEntries(timed.map((x) => [x.label, Number(x.ms.toFixed(1))])),
    maxMs: Number(Math.max(...timed.map((x) => x.ms)).toFixed(1)),
  };
}

async function buildSidecarRollup(dbPath) {
  const source = { id: "custom", label: "Custom", dbPath };
  return measure("buildUsageRollup", () => usageRollup.buildAndWriteUsageRollupForSource(source, { adapter: "node:sqlite" }));
}

async function runSize(messageCount) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-agg-"));
  const dbPath = path.join(tmp, `stress-${messageCount}.db`);
  const previousConfigDir = process.env.CODEARTS_BAR_CONFIG_DIR;
  const previousDisableRollupBuild = process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
  process.env.CODEARTS_BAR_CONFIG_DIR = path.join(tmp, "config");
  process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = "1";
  try {
    const created = createFixtureDb(dbPath, messageCount);
    if (!created) return;
    const timestamp = Date.UTC(2026, 6, 9, 12, 0, 0);
    const payload = {
      dbPath,
      timestamp,
      range: { start: timestamp - 14 * 86400000, end: timestamp },
      bucketMs: 86400000,
      slowAggregateMs: 300,
    };
    aggregation.resetSlowAggregateStats();
    const native = await runRuntime("native", dbPath, payload);
    const sqljs = await runRuntime("sql.js", dbPath, payload);
    const built = await buildSidecarRollup(dbPath);
    assert.equal(built.value.usageRollup.rowCount, messageCount, "sidecar rollup should cover all assistant messages");
    aggregateCache.clearAggregateCache();
    usageRollup.resetUsageRollupStats();
    await aggregation.clearSqlJsWorkerCaches();
    const nativeHot = await runRuntime("native", dbPath, payload, { expectRollup: true });
    aggregateCache.clearAggregateCache();
    usageRollup.resetUsageRollupStats();
    await aggregation.clearSqlJsWorkerCaches();
    const sqljsHot = await runRuntime("sql.js", dbPath, payload, { expectRollup: true });
    const hotBudgetMs = messageCount >= 50000
      ? qualityBaseline.limits.aggregationHotPathMsMax.large
      : qualityBaseline.limits.aggregationHotPathMsMax.small;
    assert.ok(nativeHot.maxMs < hotBudgetMs, `native sidecar hot path should stay below ${hotBudgetMs}ms for ${messageCount}, got ${nativeHot.maxMs}ms`);
    assert.ok(sqljsHot.maxMs < hotBudgetMs, `sql.js sidecar hot path should stay below ${hotBudgetMs}ms for ${messageCount}, got ${sqljsHot.maxMs}ms`);
    const slowStats = aggregation.slowAggregateStats();
    if (Math.max(native.maxMs, sqljs.maxMs) >= payload.slowAggregateMs) {
      assert.ok(slowStats.count > 0, "slow aggregate stats should capture cold-path slow queries");
      assert.ok(slowStats.maxMs >= payload.slowAggregateMs, "slow aggregate stats should keep max slow duration");
      assert.ok(Object.keys(slowStats.byLabel || {}).length > 0, "slow aggregate stats should group by label");
      assert.ok(Object.keys(slowStats.byAdapter || {}).length > 0, "slow aggregate stats should group by adapter");
    }
    const sessions = Math.max(1, Math.ceil(messageCount / 8));
    console.log(`ok - aggregation stress messages=${messageCount} sessions=${sessions} nativeMax=${native.maxMs}ms sqljsMax=${sqljs.maxMs}ms`);
    console.log(`     native ${JSON.stringify(native.timings)} sql.js ${JSON.stringify(sqljs.timings)}`);
    console.log(`     sidecar build=${Number(built.ms.toFixed(1))}ms nativeHot ${JSON.stringify(nativeHot.timings)} sqljsHot ${JSON.stringify(sqljsHot.timings)}`);
    console.log(`     slowAggregates count=${slowStats.count} max=${Number(slowStats.maxMs || 0).toFixed(1)}ms labels=${Object.keys(slowStats.byLabel || {}).join(",")}`);
  } finally {
    if (previousConfigDir == null) delete process.env.CODEARTS_BAR_CONFIG_DIR;
    else process.env.CODEARTS_BAR_CONFIG_DIR = previousConfigDir;
    if (previousDisableRollupBuild == null) delete process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD;
    else process.env.CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD = previousDisableRollupBuild;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  for (const size of parseSizes()) await runSize(size);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
