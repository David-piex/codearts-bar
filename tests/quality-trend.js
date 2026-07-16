'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function readJson(file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'); }
const metrics = readJson('.cache/quality-metrics.json');
const baseline = readJson('quality-baseline.json');
assert.equal(metrics.version, require('../package.json').version, 'quality metrics must match the current package version');
assert.match(metrics.commit || '', /^[0-9a-f]{40}$/i, 'quality metrics must identify the source commit');
assert.equal(metrics.qualityBaselineSha256, sha256('quality-baseline.json'), 'quality metrics must match the current quality baseline');
assert.equal(metrics.bundles.rendererSha256, sha256('src/dashboard-renderer.js'), 'quality metrics must match the current renderer artifact');
assert.equal(metrics.bundles.cssSha256, sha256('src/dashboard-bundle.css'), 'quality metrics must match the current CSS artifact');
const generatedAt = new Date(Number(process.env.CODEARTS_BAR_NOW_MS || 1783512000000)).toISOString();
const skipJetBrains = process.argv.includes('--skip-jetbrains');
const l = baseline.limits;
const checks = [
  ['rendererBytes', metrics.bundles.rendererBytes, '<=', l.rendererBytesMax],
  ['cssBytes', metrics.bundles.cssBytes, '<=', l.cssBytesMax],
  ...(!skipJetBrains ? [
    ['jetbrainsZipBytes.present', metrics.bundles.jetbrainsZipBytes, '>', 0],
    ['jetbrainsZipBytes', metrics.bundles.jetbrainsZipBytes, '<=', l.jetbrainsZipBytesMax],
  ] : []),
  ['snapshotMs', metrics.runtime.snapshotMs, '<=', l.snapshotMsMax],
  ['coverage.lines', metrics.coverage?.lines?.pct, '>=', l.coverageLinesMin],
  ['coverage.functions', metrics.coverage?.functions?.pct, '>=', l.coverageFunctionsMin],
  ['coverage.branches', metrics.coverage?.branches?.pct, '>=', l.coverageBranchesMin],
];
const results = checks.map(([name, actual, operator, expected]) => ({ name, actual: Number(actual), operator, expected, ok: operator === '<=' ? Number(actual) <= expected : operator === '>' ? Number(actual) > expected : Number(actual) >= expected }));
const trend = { schemaVersion: 2, generatedAt, version: metrics.version, commit: metrics.commit, baseline: l, results, ok: results.every((item) => item.ok) };
const out = path.join(root, '.cache', 'quality-trend.json');
fs.writeFileSync(out, JSON.stringify(trend, null, 2) + '\n');
for (const item of results) console.log(`${item.ok ? 'ok' : 'FAIL'} quality ${item.name} ${item.actual} ${item.operator} ${item.expected}`);
assert.equal(trend.ok, true, `quality regression: ${results.filter((item) => !item.ok).map((item) => item.name).join(', ')}`);
