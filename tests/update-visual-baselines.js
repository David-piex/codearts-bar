'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baselineDir = path.join(root, 'tests', 'visual-baselines');
const screenshotDir = path.join(root, 'docs', 'screenshots');
const electronDir = path.join(root, '.cache', 'electron-visual');
const images = [
  ['vscode-tooltip.png', screenshotDir],
  ['vscode-empty-state.png', screenshotDir],
  ['desktop-standard.png', electronDir],
  ['desktop-narrow.png', electronDir],
  ['desktop-wide-layout.png', electronDir],
  ['desktop-sessions.png', electronDir],
  ['desktop-export-dialog.png', electronDir],
  ['desktop-date-picker.png', electronDir],
];
fs.mkdirSync(baselineDir, { recursive: true });
for (const [name, sourceDir] of images) {
  const source = path.join(sourceDir, name);
  if (!fs.existsSync(source)) throw new Error(`Generate screenshots before updating baseline: ${source}`);
  fs.copyFileSync(source, path.join(baselineDir, name));
}
console.log(`updated ${images.length} visual baselines`);
