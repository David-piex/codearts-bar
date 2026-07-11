'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
process.env.CODEARTS_BAR_DB ||= path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
process.env.CODEARTS_BAR_CONFIG_DIR ||= path.join(root, '.cache', 'quality-config');
function size(file) { try { return fs.statSync(path.join(root, file)).size; } catch { return 0; } }
function count(dir, ext) { let n = 0; for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) n += count(p, ext); else if (e.name.endsWith(ext)) n++; } return n; }
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
async function timedSnapshot(getSnapshotWithCache) { const started = performance.now(); const snapshot = await getSnapshotWithCache(); return { snapshot, ms: Number((performance.now() - started).toFixed(1)) }; }
async function main() {
  const { getSnapshotWithCache } = require('../src/codeartsData');
  const cold = await timedSnapshot(getSnapshotWithCache);
  const warmSamples = [];
  let snapshot = cold.snapshot;
  for (let i = 0; i < 3; i += 1) { const sample = await timedSnapshot(getSnapshotWithCache); warmSamples.push(sample.ms); snapshot = sample.snapshot; }
  let coverage = null;
  try { coverage = JSON.parse(fs.readFileSync(path.join(root, '.cache/coverage/coverage-summary.json'), 'utf8')).total; } catch {}
  const metrics = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    version: require('../package.json').version,
    bundles: { rendererBytes: size('src/dashboard-renderer.js'), cssBytes: size('src/dashboard-bundle.css'), jetbrainsZipBytes: (() => { try { const dir = path.join(root, 'jetbrains-plugin/build/distributions'); const name = fs.readdirSync(dir).find((x) => x.endsWith('.zip')); return name ? fs.statSync(path.join(dir, name)).size : 0; } catch { return 0; } })() },
    runtime: { snapshotMs: median(warmSamples), coldSnapshotMs: cold.ms, warmSamplesMs: warmSamples, adapter: snapshot.adapter || '', messages: snapshot.usage?.all?.messages || 0 },
    source: { jsFiles: count('src', '.js'), testFiles: count('tests', '.js') },
    coverage,
  };
  const out = path.join(root, '.cache', 'quality-metrics.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(metrics, null, 2) + '\n');
  console.log(`quality metrics: ${path.relative(root, out)} cold=${metrics.runtime.coldSnapshotMs}ms warmMedian=${metrics.runtime.snapshotMs}ms`);
}
main().catch((error) => { console.error(error); process.exit(1); });
