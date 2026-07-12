"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

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
  assert.equal(summary.capabilities.performance, false);
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
  assert.equal(details.capabilities.performance, false);
  assert.ok(Array.isArray(details.trends.hourly24h));
  assert.ok(Array.isArray(details.trends.daily14d));
  assert.ok(Array.isArray(details.models));
  assert.ok(Array.isArray(details.sourceStats));
  assert.ok(Array.isArray(details.sessions));
  assert.ok(details.sessions.length <= 8);
  assert.ok(detailsMs < 1000, `extension detail aggregate should stay below 1000ms, got ${detailsMs.toFixed(1)}ms`);
  console.log(`ok - extension staged refresh summary=${firstMs.toFixed(1)}ms hot=${hotMs.toFixed(1)}ms details=${detailsMs.toFixed(1)}ms`);
})().catch((error) => { console.error(error); process.exit(1); });
