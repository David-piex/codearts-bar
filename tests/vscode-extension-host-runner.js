'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const root = path.resolve(__dirname, '..');
  const resultFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-vscode-host-')), 'result.json');
  try {
    await runTests({
      version: process.env.CODEARTS_BAR_VSCODE_VERSION || 'stable',
      extensionDevelopmentPath: path.join(root, 'extension'),
      extensionTestsPath: path.join(root, 'tests', 'vscode-extension-host', 'index.js'),
      launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', path.join(root, '.cache', 'vscode-host-workspace')],
      extensionTestsEnv: { ...process.env, CODEARTS_BAR_EXTENSION_HOST_RESULT: resultFile },
    });
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.equal(result.ok, true);
    console.log(`ok - vscode extension host runner activation=${result.activationMs}ms refresh=${result.refreshMs}ms`);
  } finally {
    try { fs.rmSync(path.dirname(resultFile), { recursive: true, force: true }); } catch {}
  }
})().catch((error) => { console.error(error); process.exit(1); });
