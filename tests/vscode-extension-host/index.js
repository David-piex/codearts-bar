'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('local-codearts.codearts-bar-status');
  assert.ok(extension, 'CodeArts Bar extension should be installed in the Extension Host');
  const started = Date.now();
  await extension.activate();
  const activationMs = Date.now() - started;
  assert.equal(extension.isActive, true);
  const commandStarted = Date.now();
  await vscode.commands.executeCommand('codeartsBar.refresh');
  const refreshMs = Date.now() - commandStarted;
  assert.ok(activationMs < 5000, `extension activation should stay below 5s, got ${activationMs}ms`);
  assert.ok(refreshMs < 3000, `extension refresh command should stay below 3s, got ${refreshMs}ms`);
  const resultFile = process.env.CODEARTS_BAR_EXTENSION_HOST_RESULT;
  if (resultFile) fs.writeFileSync(resultFile, JSON.stringify({ ok: true, activationMs, refreshMs, vscode: vscode.version }, null, 2), 'utf8');
  console.log(`ok - vscode extension host activation=${activationMs}ms refresh=${refreshMs}ms vscode=${vscode.version}`);
}
module.exports = { run };
