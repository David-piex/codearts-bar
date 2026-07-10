'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const baselineDir = path.join(root, 'tests', 'visual-baselines');
const screenshotDir = path.join(root, 'docs', 'screenshots');
const electronDir = path.join(root, '.cache', 'electron-visual');
const outputDir = path.join(root, '.cache', 'visual-regression');
const cases = [
  { name: 'vscode-tooltip.png', actualDir: screenshotDir, maxDiffRatio: 0.0025 },
  { name: 'vscode-empty-state.png', actualDir: screenshotDir, maxDiffRatio: 0.0015 },
  { name: 'desktop-standard.png', actualDir: electronDir, maxDiffRatio: 0.003 },
  { name: 'desktop-narrow.png', actualDir: electronDir, maxDiffRatio: 0.003 },
  { name: 'desktop-wide-layout.png', actualDir: electronDir, maxDiffRatio: 0.003 },
  { name: 'desktop-sessions.png', actualDir: electronDir, maxDiffRatio: 0.003 },
  { name: 'desktop-date-picker.png', actualDir: electronDir, maxDiffRatio: 0.003 },
];

function readPng(file) {
  assert.ok(fs.existsSync(file), `missing visual image: ${path.relative(root, file)}`);
  return PNG.sync.read(fs.readFileSync(file));
}

(async () => {
  const { default: pixelmatch } = await import('pixelmatch');
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const failures = [];
  for (const item of cases) {
    const baselineFile = path.join(baselineDir, item.name);
    const actualFile = path.join(item.actualDir, item.name);
    const baseline = readPng(baselineFile);
    const actual = readPng(actualFile);
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      failures.push(`${item.name} size ${actual.width}x${actual.height}, expected ${baseline.width}x${baseline.height}`);
      continue;
    }
    const diff = new PNG({ width: actual.width, height: actual.height });
    const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, actual.width, actual.height, {
      threshold: 0.12,
      includeAA: false,
      alpha: 0.55,
      diffColor: [255, 42, 85],
      aaColor: [255, 190, 0],
    });
    const pixels = actual.width * actual.height;
    const ratio = diffPixels / pixels;
    if (diffPixels > 0) fs.writeFileSync(path.join(outputDir, item.name.replace(/\.png$/i, '.diff.png')), PNG.sync.write(diff));
    console.log(`visual ${item.name}: changed=${diffPixels} ratio=${(ratio * 100).toFixed(4)}% limit=${(item.maxDiffRatio * 100).toFixed(3)}%`);
    if (ratio > item.maxDiffRatio) failures.push(`${item.name} changed ${(ratio * 100).toFixed(4)}%, limit ${(item.maxDiffRatio * 100).toFixed(3)}%`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log('ok - visual regression');
})().catch((error) => { console.error(error); process.exit(1); });
