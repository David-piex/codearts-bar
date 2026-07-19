'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const baseline = require('../quality-baseline.json');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'dashboard-css-sources.json'), 'utf8'));
assert.equal(manifest.length, 11, 'dashboard CSS domain source count must not grow without an intentional budget update');
for (const owner of ['styles/domain-controls.css','styles/domain-sessions.css','styles/domain-chart.css','styles/domain-semantic.css','styles/domain-workbench.css']) assert.equal(manifest.includes(owner), true, `semantic owner missing from CSS manifest: ${owner}`);
const source = manifest.map((rel) => fs.readFileSync(path.join(src, rel), 'utf8')).join('\n');
const domainBudgets = {
  'styles/domain-shell.css': { important:2, bytes:27 * 1024 },
  'styles/domain-inspector.css': { important:1, bytes:13 * 1024 },
  'styles/domain-controls.css': { important:0, bytes:37 * 1024 },
  'styles/domain-analytics.css': { important:7, bytes:38 * 1024 },
  'styles/domain-sessions.css': { important:3, bytes:37 * 1024 },
  'styles/domain-chart.css': { important:5, bytes:37 * 1024 },
  'styles/domain-responsive.css': { important:4, bytes:41 * 1024 },
  'styles/domain-native.css': { important:17, bytes:28 * 1024 },
  'styles/domain-semantic.css': { important:21, bytes:26 * 1024 },
  'styles/domain-workbench.css': { important:0, bytes:14 * 1024 },
  // The final calibration layer owns the software-rendering fallback and
  // interaction states; keep it bounded separately from product surfaces.
  'styles/domain-taste.css': { important:0, bytes:5 * 1024 },
};
for (const rel of manifest) {
  const domainSource = fs.readFileSync(path.join(src, rel), 'utf8');
  const budget = domainBudgets[rel];
  assert.ok(budget, `CSS domain is missing an explicit complexity budget: ${rel}`);
  const important = (domainSource.match(/!important/g) || []).length;
  const bytes = Buffer.byteLength(domainSource);
  assert.ok(important <= budget.important, `CSS domain !important budget exceeded for ${rel}: ${important} > ${budget.important}`);
  assert.ok(bytes <= budget.bytes, `CSS domain byte budget exceeded for ${rel}: ${bytes} > ${budget.bytes}`);
}
assert.deepEqual(Object.keys(domainBudgets).sort(), [...manifest].sort(), 'CSS domain budget list must match the manifest exactly');
const count = (pattern) => (source.match(pattern) || []).length;
const countEffects = (property) => [...source.matchAll(new RegExp(`${property}\\s*:\\s*([^;}]+)`, 'g'))]
  .filter((match) => !/^none(?:\s*!important)?$/i.test(match[1].trim())).length;
const metrics = {
  important:count(/!important/g),
  backdropFilter:countEffects('(?:-webkit-)?backdrop-filter'),
  boxShadow:countEffects('box-shadow'),
  media:count(/@media/g),
};
assert.ok(metrics.important <= 60, `!important budget exceeded: ${metrics.important}`);
assert.ok(metrics.backdropFilter <= 60, `effectful backdrop-filter budget exceeded: ${metrics.backdropFilter}`);
assert.ok(metrics.boxShadow <= 265, `effectful box-shadow budget exceeded: ${metrics.boxShadow}`);
assert.ok(metrics.media <= 70, `media-query budget exceeded: ${metrics.media}`);
const bundleBytes = fs.statSync(path.join(src, 'dashboard-bundle.css')).size;
assert.ok(bundleBytes <= baseline.limits.cssBytesMax, `dashboard CSS bundle exceeded ${baseline.limits.cssBytesMax} bytes: ${bundleBytes}`);
const popover = fs.readFileSync(path.join(src, 'styles', 'domain-semantic.css'), 'utf8');
assert.match(popover, /\.date-range-popover,\s*\.chart-tip,\s*\.perf-panel\s*\{[^}]*color:\s*var\(--cb-text\)/s, 'popover semantic owner should share the common text color rule');
console.log(`ok - dashboard css budget bundle=${bundleBytes} important=${metrics.important} backdrop=${metrics.backdropFilter} shadow=${metrics.boxShadow} media=${metrics.media}`);
