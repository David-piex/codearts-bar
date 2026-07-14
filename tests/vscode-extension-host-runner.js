'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const root = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-vscode-host-'));
  const resultFile = path.join(tempDir, 'result.json');
  const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
  try {
    await runTests({
      version: process.env.CODEARTS_BAR_VSCODE_VERSION || 'stable',
      extensionDevelopmentPath: path.join(root, '.cache', 'extension-staging'),
      extensionTestsPath: path.join(root, 'tests', 'vscode-extension-host', 'index.js'),
      launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', path.join(root, '.cache', 'vscode-host-workspace')],
      extensionTestsEnv: {
        ...process.env,
        CODEARTS_BAR_EXTENSION_HOST_RESULT: resultFile,
        CODEARTS_BAR_DB: fixtureDb,
        CODEARTS_BAR_CONFIG_DIR: path.join(tempDir, 'config'),
        CODEARTS_BAR_NOW_MS: '1783512000000',
        CODEARTS_BAR_DISABLE_USAGE_LOGS: '1',
        HOME: path.join(tempDir, 'home'),
        USERPROFILE: path.join(tempDir, 'home'),
        APPDATA: path.join(tempDir, 'home', 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(tempDir, 'home', 'AppData', 'Local'),
      },
    });
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.equal(result.ok, true);
    console.log(`ok - vscode extension host runner activation=${result.activationMs}ms refresh=${result.refreshMs}ms`);
  } finally {
    try { fs.rmSync(path.dirname(resultFile), { recursive: true, force: true }); } catch {}
  }
})().catch((error) => { console.error(error); process.exit(1); });
