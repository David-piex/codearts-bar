'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-electron-visual-'));
fs.mkdirSync(path.join(tempDir, 'home', 'AppData', 'Roaming'), { recursive: true });
fs.mkdirSync(path.join(tempDir, 'home', 'AppData', 'Local'), { recursive: true });
const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
const stdoutPath = path.join(tempDir, 'electron.stdout.log');
const stderrPath = path.join(tempDir, 'electron.stderr.log');
const stdoutFd = fs.openSync(stdoutPath, 'w');
const stderrFd = fs.openSync(stderrPath, 'w');
const result = spawnSync(electronPath, [path.join(root, 'tests', 'electron-dashboard-e2e-runner.js')], {
  cwd: root,
  timeout: 60000,
  windowsHide: true,
  stdio: ['ignore', stdoutFd, stderrFd],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    CODEARTS_BAR_E2E: '1',
    CODEARTS_BAR_E2E_SCREENSHOT_DIR: outputDir,
    CODEARTS_BAR_DB: fixtureDb,
    CODEARTS_BAR_CONFIG_DIR: path.join(tempDir, 'config'),
    CODEARTS_BAR_NOW_MS: '1783598400000',
    CODEARTS_BAR_DISABLE_USAGE_LOGS: '1',
    HOME: path.join(tempDir, 'home'),
    USERPROFILE: path.join(tempDir, 'home'),
    APPDATA: path.join(tempDir, 'home', 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(tempDir, 'home', 'AppData', 'Local'),
  },
});
fs.closeSync(stdoutFd);
fs.closeSync(stderrFd);
const stdout = fs.readFileSync(stdoutPath, 'utf8');
const stderr = fs.readFileSync(stderrPath, 'utf8');
try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
if (result.error) throw result.error;
assert.equal(result.status, 0, `Electron visual capture exited with ${result.status}`);
for (const name of ['desktop-standard.png', 'desktop-dark.png', 'desktop-empty-state.png', 'desktop-narrow.png', 'desktop-wide-layout.png', 'desktop-sessions.png', 'desktop-sessions-dark.png', 'desktop-export-dialog.png', 'desktop-date-picker.png', 'desktop-date-picker-dark.png']) {
  assert.ok(fs.existsSync(path.join(outputDir, name)), `missing Electron visual capture ${name}`);
}
console.log(`ok - electron visual capture ${outputDir}`);
