'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.cache', 'electron-visual');
const electronRoot = path.dirname(require.resolve('electron/package.json'));
const electronPathFile = path.join(electronRoot, 'path.txt');
const overrideDist = process.env.ELECTRON_OVERRIDE_DIST_PATH;
const executableName = fs.existsSync(electronPathFile) ? fs.readFileSync(electronPathFile, 'utf8').trim() : '';
const electronPath = overrideDist
  ? path.join(overrideDist, executableName || (process.platform === 'win32' ? 'electron.exe' : 'electron'))
  : executableName ? path.join(electronRoot, 'dist', executableName) : '';
if (!electronPath || !fs.existsSync(electronPath)) {
  throw new Error('Electron visual capture requires an installed Electron binary; run npm install with Electron download access before visual tests.');
}
fs.rmSync(outputDir, { recursive: true, force: true });
const result = spawnSync(electronPath, [path.join(root, 'tests', 'electron-dashboard-e2e-runner.js')], {
  cwd: root,
  encoding: 'utf8',
  timeout: 60000,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    CODEARTS_BAR_E2E: '1',
    CODEARTS_BAR_E2E_SCREENSHOT_DIR: outputDir,
  },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.status, 0, `Electron visual capture exited with ${result.status}`);
for (const name of ['desktop-standard.png', 'desktop-narrow.png', 'desktop-wide-layout.png', 'desktop-sessions.png', 'desktop-date-picker.png']) {
  assert.ok(fs.existsSync(path.join(outputDir, name)), `missing Electron visual capture ${name}`);
}
console.log(`ok - electron visual capture ${outputDir}`);
