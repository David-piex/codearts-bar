"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const localProvider = require(path.join(__dirname, "..", "src", "providers", "codeartsLocal.js"));
const { redactSensitiveText } = require(path.join(__dirname, "..", "src", "core", "sensitive-text.js"));
const { viewModel } = require(path.join(__dirname, "..", "extension", "webview", "model.js"));

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "extension-data.js"), "utf8");
assert.doesNotMatch(source, /getSnapshotWithCache|collectRows|loadSettings/);
assert.match(source, /useSavedSettings: false/);
assert.match(source, /getSummary/);
assert.match(source, /getDashboardAggregates/);
assert.match(source, /getSessionsPage/);

const data = require(path.join(root, "src", "extension-data.js"));
(async () => {
  const options = { dbPath: path.join(root, "tests", "fixtures", "opencode-fixture.db") };
  const firstStart = performance.now();
  const summary = await data.getExtensionSummary(options);
  const firstMs = performance.now() - firstStart;
  assert.equal(summary.ok, true);
  assert.equal(summary.summaryOnly, true);
  assert.equal(summary.capabilities.performance, true);
  assert.ok(summary.usage?.all);
  assert.deepEqual(summary.trends, { hourly24h: [], daily14d: [] });
  const hotStart = performance.now();
  const hotSummary = await data.getExtensionSummary(options);
  const hotMs = performance.now() - hotStart;
  assert.equal(hotSummary.ok, true);
  assert.ok(hotMs < 150, `hot summary should stay below 150ms, got ${hotMs.toFixed(1)}ms`);

  const detailsStart = performance.now();
  const details = await data.getExtensionDetails(options);
  const detailsMs = performance.now() - detailsStart;
  assert.equal(details.ok, true);
  assert.equal(details.summaryOnly, false);
  assert.equal(details.capabilities.performance, true);
  assert.ok(Array.isArray(details.trends.hourly24h));
  assert.ok(Array.isArray(details.trends.daily14d));
  assert.ok(Array.isArray(details.models));
  assert.ok(details.filterModels.length > 0, 'unfiltered details must expose model filter options on first load');
  assert.ok(details.filterProjects.length > 0, 'unfiltered details must expose project filter options on first load');
  assert.ok(Array.isArray(details.sourceStats));
  assert.ok(Array.isArray(details.providerStats));
  assert.ok(Array.isArray(details.projects));
  assert.ok(Array.isArray(details.diagnostics.items));
  assert.equal(typeof details.performance.window.errorRate, 'number');
  assert.ok(Array.isArray(details.sessions));
  assert.ok(details.sessions.length <= 8);
  assert.ok(details.requestTotal >= details.requests.length);
  assert.ok(details.sessionTotal >= details.sessions.length);
  assert.ok(detailsMs < 1000, `extension detail aggregate should stay below 1000ms, got ${detailsMs.toFixed(1)}ms`);
  const customEnd = Date.now() - 60000;
  const customStart = customEnd - 7 * 86400000;
  const custom = await data.getExtensionDetails({ ...options, rangePreset: "custom", range: { start: customStart, end: customEnd } });
  const desktopAggregate = await localProvider.getDashboardAggregates({ ...options, useSavedSettings: false, timestamp: custom.timestamp, range: { start: customStart, end: customEnd }, bucketMs: custom.selectedRange.bucketMs });
  assert.equal(custom.selectedRange.preset, "custom");
  assert.equal(custom.selectedRange.start, customStart);
  assert.equal(custom.selectedRange.end, customEnd);
  assert.deepEqual(custom.trends.range, desktopAggregate.buckets, "extension trend must match the desktop aggregate for the same range");
  assert.deepEqual(custom.models, desktopAggregate.modelStats, "extension models must expose the complete desktop aggregate for the same range");
  assert.deepEqual(custom.sourceStats, desktopAggregate.sourceStats, "extension sources must match the desktop aggregate for the same range");
  assert.deepEqual(custom.usage.range, data.scopedUsage(desktopAggregate.sourceStats), "extension token/cache totals must use the desktop aggregate semantics");

  const original = {
    getSummary: localProvider.getSummary,
    getDashboardAggregates: localProvider.getDashboardAggregates,
    getSessionsPage: localProvider.getSessionsPage,
    getRequestsPage: localProvider.getRequestsPage,
    getDatabaseHealth: localProvider.getDatabaseHealth,
    getModelStats: localProvider.getModelStats,
    getSessionSummary: localProvider.getSessionSummary,
  };
  let currentSummaryOptions;
  try {
    localProvider.getSummary = async (request) => {
      currentSummaryOptions = request;
      return {
        ok: true,
        usage: {
          today: { total: 80, messages: 2 },
          window: { total: 120, messages: 3 },
          week: { total: 180, messages: 4 },
          all: { total: 240, messages: 5 },
        },
        sources: [],
      };
    };
    localProvider.getDashboardAggregates = async () => ({
      ok: true,
      usage: { today: { total: 999 }, window: { total: 999 }, week: { total: 999 }, all: { total: 999 } },
      buckets: [], modelStats: [], sources: [], sourceErrors: [],
      sourceStats: [{ total: 30, input: 20, output: 10, messages: 1 }],
    });
    localProvider.getSessionsPage = async () => ({ items: [], total: 0 });
    localProvider.getRequestsPage = async () => ({ items: [], total: 0 });
    const historical = await data.getExtensionDetails({
      dailyLimit: 200,
      rangePreset: "custom",
      range: { start: customStart, end: customEnd },
      source: "desktop",
      model: "fixture-model",
    });
    assert.equal(historical.usage.today.total, 80, "current usage windows must come from an unfiltered current summary");
    assert.equal(historical.usage.range.total, 30, "historical usage must remain scoped to the selected range");
    assert.equal(historical.status.usagePercent, 40, "historical filters must not replace the current local status");
    assert.equal(historical.quota.primary.used, 80, "historical filters must not replace current local quota usage");
    assert.equal(currentSummaryOptions.source, "all");
    assert.equal(currentSummaryOptions.model, "all");
    assert.equal("range" in currentSummaryOptions, false);
    assert.equal("rangePreset" in currentSummaryOptions, false);
  } finally {
    Object.assign(localProvider, original);
  }
  const privateFailure = 'failure {"access_token":"snapshot-secret"} Bearer snapshot-bearer at C:\\Users\\private-win-user\\project\\file.js and /home/private-linux-user/project/file.js\nprivate-stack-frame';
  try {
    localProvider.getSummary = async () => ({ ok: true, usage: { today: {}, window: {}, week: {}, all: {} }, sources: [] });
    localProvider.getDashboardAggregates = async () => ({
      ok: true,
      buckets: [],
      modelStats: [],
      sources: [{ id: 'read-source' }],
      expectedSources: ['read-source', 'failed-source'],
      sourceStats: [{ source: 'read-source', total: 0, messages: 0 }],
      sourceErrors: [{ source: 'failed-source', message: privateFailure }],
      performance: { samples: 0, complete: true, metricCompleteness: { latency: true, firstContentApprox: false, outputTokensPerSec: false, ttft: false } },
    });
    localProvider.getSessionsPage = async () => ({ items: [], total: 0 });
    localProvider.getRequestsPage = async () => ({ items: [{ id: 'private', sessionTitle: privateFailure, error: privateFailure }], total: 1 });
    localProvider.getDatabaseHealth = async () => ({ items: [], sourceErrors: [{ source: 'failed-source', message: privateFailure }] });
    localProvider.getModelStats = async () => ({ ok: true, items: [], sourceErrors: [{ source: 'failed-source', message: privateFailure }] });
    localProvider.getSessionSummary = async () => ({ ok: true, projects: [], sourceErrors: [] });
    const privateDetails = await data.getExtensionDetails({ ...options, rangePreset: 'custom', range: { start: customStart, end: customEnd } });
    const privateView = viewModel(privateDetails);
    assert.equal(privateView.filterOptionsComplete, false, 'partial filter-option reads must not prune user selections');
    assert.equal(privateView.completeness.complete, false);
    assert.deepEqual(privateView.completeness.reasons, ['source-read-failed']);
    assert.deepEqual(privateView.completeness.sources, { expected: 2, read: 1, failed: 1, missing: 0 });
    const serialized = JSON.stringify(privateView);
    for (const forbidden of ['snapshot-secret', 'snapshot-bearer', 'private-win-user', 'private-linux-user', 'private-stack-frame']) {
      assert.equal(serialized.includes(forbidden), false, `VS Code snapshot leaked ${forbidden}`);
    }
    assert.match(privateView.requests[0].error, /\[path\]/);
    assert.equal(privateView.requests[0].error.includes('\n'), false);
  } finally {
    Object.assign(localProvider, original);
  }
  assert.throws(() => data.extensionRange({ rangePreset: "custom", range: { start: customEnd, end: customStart } }, customEnd + 60000), /有效/);
  const secretTitle = "调用服务 access_key: HPUAGKFNIOIQEPEJGSC9, secret_key: JKcewe";
  const redacted = data.sessionView({ id: "s", title: secretTitle, directory: "C:/token=abc", usage: {} }, customEnd);
  assert.doesNotMatch(redacted.title, /HPUAGK|JKcewe/);
  assert.doesNotMatch(redacted.directory, /abc/);
  assert.match(redacted.title, /\[redacted\]/);
  assert.equal(redactSensitiveText("Token 使用分析"), "Token 使用分析");
  console.log(`ok - extension staged refresh summary=${firstMs.toFixed(1)}ms hot=${hotMs.toFixed(1)}ms details=${detailsMs.toFixed(1)}ms`);
})().catch((error) => { console.error(error); process.exit(1); });
