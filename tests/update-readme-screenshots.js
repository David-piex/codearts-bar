'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, '.cache', 'electron-visual');
const targetDir = path.join(root, 'docs', 'screenshots');
const files = {
  'desktop-wide-layout.png': 'dashboard-wide.png',
  'desktop-standard.png': 'dashboard-maximized.png',
  'desktop-narrow.png': 'dashboard-narrow.png',
  'desktop-sessions.png': 'session-management.png',
  'desktop-date-picker.png': 'date-picker.png',
};
fs.mkdirSync(targetDir, { recursive: true });
for (const [sourceName, targetName] of Object.entries(files)) {
  const source = path.join(sourceDir, sourceName);
  if (!fs.existsSync(source)) throw new Error(`missing Electron screenshot: ${source}`);
  fs.copyFileSync(source, path.join(targetDir, targetName));
}
console.log(`ok - README Electron screenshots ${Object.keys(files).length}`);
