'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const { execFileSync } = require('node:child_process');
const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
const fixtureNow = Number(process.env.CODEARTS_BAR_NOW_MS || 1783512000000);
process.env.CODEARTS_BAR_DB = fixtureDb;
process.env.CODEARTS_BAR_CONFIG_DIR = path.join(root, '.cache', 'quality-config');
process.env.CODEARTS_BAR_NOW_MS = String(fixtureNow);
const snapshotOptions = { dbPath: fixtureDb, timestamp: fixtureNow, fixtureMode: true, disableEnvironmentProbes: true, disableUsageLogs: true, useSavedSettings: false };
function size(file) { try { return fs.statSync(path.join(root, file)).size; } catch { return 0; } }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'); }
function count(dir, ext) { let n = 0; for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) n += count(p, ext); else if (e.name.endsWith(ext)) n++; } return n; }
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function readCoverage(relativePath) {
  try { return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')).total; }
  catch { return null; }
}
function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}
async function timedSnapshot(getSnapshotWithCache) { const started = performance.now(); const snapshot = await getSnapshotWithCache(snapshotOptions); return { snapshot, ms: Number((performance.now() - started).toFixed(1)) }; }
async function main() {
  const { getSnapshotWithCache } = require('../src/codeartsData');
  const cold = await timedSnapshot(getSnapshotWithCache);
  const warmSamples = [];
  let snapshot = cold.snapshot;
  for (let i = 0; i < 3; i += 1) { const sample = await timedSnapshot(getSnapshotWithCache); warmSamples.push(sample.ms); snapshot = sample.snapshot; }
  const coverage = readCoverage('.cache/coverage/coverage-summary.json');
  const coverageAll = readCoverage('.cache/coverage-all/coverage-summary.json');
  const metrics = {
    schemaVersion: 2,
    generatedAt: new Date(fixtureNow).toISOString(),
    version: require('../package.json').version,
    commit: currentCommit(),
    qualityBaselineSha256: sha256('quality-baseline.json'),
    bundles: {
      rendererBytes: size('src/dashboard-renderer.js'), rendererSha256: sha256('src/dashboard-renderer.js'),
      cssBytes: size('src/dashboard-bundle.css'), cssSha256: sha256('src/dashboard-bundle.css'),
      jetbrainsZipBytes: (() => { const name = `codearts-bar-jetbrains-${require('../package.json').version}.zip`; try { return fs.statSync(path.join(root, 'jetbrains-plugin/build/distributions', name)).size; } catch { return 0; } })(),
    },
    runtime: { snapshotMs: median(warmSamples), coldSnapshotMs: cold.ms, warmSamplesMs: warmSamples, adapter: snapshot.adapter || '', messages: snapshot.usage?.all?.messages || 0 },
    source: { jsFiles: count('src', '.js'), testFiles: count('tests', '.js') },
    coverage,
    coverageAll,
  };
  const out = path.join(root, '.cache', 'quality-metrics.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(metrics, null, 2) + '\n');
  console.log(`quality metrics: ${path.relative(root, out)} cold=${metrics.runtime.coldSnapshotMs}ms warmMedian=${metrics.runtime.snapshotMs}ms`);
}
main().catch((error) => { console.error(error); process.exit(1); });
