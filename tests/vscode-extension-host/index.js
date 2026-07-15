'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('local-codearts.codearts-bar-status');
  assert.ok(extension, 'CodeArts Bar extension should be installed in the Extension Host');
  assert.ok(extension.packageJSON.files.includes('session-export.js'), 'installed extension should whitelist the export privacy workflow');
  assert.ok(fs.existsSync(path.join(extension.extensionPath, 'session-export.js')), 'installed extension should contain the export privacy workflow');
  const started = Date.now();
  await extension.activate();
  const activationMs = Date.now() - started;
  assert.equal(extension.isActive, true);
  const commandStarted = Date.now();
  await vscode.commands.executeCommand('codeartsBar.refresh');
  const refreshMs = Date.now() - commandStarted;
  const api = extension.exports;
  assert.equal(typeof api.querySessionsPage, 'function');
  assert.equal(typeof api.queryRequestsPage, 'function');
  assert.equal(typeof api.exportSession, 'function');
  const sessionOptions = { page: 2, pageSize: 1, search: 'session', source: 'all', model: 'all', project: 'C:/fixture', range: { start: 0, end: 9999999999999 } };
  const sessions = await api.querySessionsPage(sessionOptions);
  assert.equal(sessions.ok, true);
  assert.equal(sessions.data.page, 2);
  assert.equal(sessions.data.pageSize, 1);
  assert.equal(sessions.data.total, 2);
  assert.equal(sessions.data.items.length, 1);
  const requestOptions = { page: 2, pageSize: 1, source: 'all', model: 'multi-model', range: { start: 0, end: 9999999999999 } };
  const requests = await api.queryRequestsPage(requestOptions);
  assert.equal(requests.ok, true);
  assert.equal(requests.data.page, 2);
  assert.equal(requests.data.total, 2);
  assert.equal(requests.data.items.length, 1);
  assert.equal(requests.data.items[0].model, 'multi-model');
  assert.equal(typeof requests.data.items[0].input, 'number');
  assert.equal(typeof requests.data.items[0].output, 'number');
  const exportDir = process.env.CODEARTS_BAR_EXTENSION_HOST_EXPORT_DIR;
  assert.ok(exportDir, 'extension host export directory is required');
  const localProvider = require(path.join(extension.extensionPath, 'providers', 'codeartsLocal.js'));
  const { databasePagePayload } = require(path.join(extension.extensionPath, 'protocol', 'query-results.js'));
  const providerOptions = { dbPath: process.env.CODEARTS_BAR_DB, useSavedSettings: false };
  const directSessions = await localProvider.getSessionsPage({
    ...providerOptions,
    source: sessionOptions.source,
    model: sessionOptions.model,
    project: sessionOptions.project,
    status: 'active',
    query: sessionOptions.search,
    range: sessionOptions.range,
    limit: sessionOptions.pageSize,
    offset: (sessionOptions.page - 1) * sessionOptions.pageSize,
  });
  const canonicalSessions = databasePagePayload(directSessions, { ...sessionOptions, resource: 'sessions' });
  assert.deepEqual(
    { total: sessions.data.total, page: sessions.data.page, pageSize: sessions.data.pageSize, pageCount: sessions.data.pageCount, hasMore: sessions.data.hasMore, ids: sessions.data.items.map((item) => item.id) },
    { total: canonicalSessions.data.total, page: canonicalSessions.data.page, pageSize: canonicalSessions.data.pageSize, pageCount: canonicalSessions.data.pageCount, hasMore: canonicalSessions.data.hasMore, ids: canonicalSessions.data.items.map((item) => item.id) },
  );
  const directRequests = await localProvider.getRequestsPage({
    ...providerOptions,
    source: requestOptions.source,
    model: requestOptions.model,
    query: '',
    range: requestOptions.range,
    limit: requestOptions.pageSize,
    offset: (requestOptions.page - 1) * requestOptions.pageSize,
  });
  const canonicalRequests = databasePagePayload(directRequests, { ...requestOptions, resource: 'requests' });
  assert.deepEqual(
    { total: requests.data.total, page: requests.data.page, pageSize: requests.data.pageSize, pageCount: requests.data.pageCount, hasMore: requests.data.hasMore, ids: requests.data.items.map((item) => item.id) },
    { total: canonicalRequests.data.total, page: canonicalRequests.data.page, pageSize: canonicalRequests.data.pageSize, pageCount: canonicalRequests.data.pageCount, hasMore: canonicalRequests.data.hasMore, ids: canonicalRequests.data.items.map((item) => item.id) },
  );
  for (const field of ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']) {
    assert.equal(requests.data.items[0][field], canonicalRequests.data.items[0][field], `VS Code request ${field} must match the shared database page`);
  }
  for (const format of ['json', 'md', 'xlsx']) {
    const outputPath = path.join(exportDir, `vscode-session.${format}`);
    const exported = await localProvider.exportSessionToFile({
      sessionId: sessions.data.items[0].id,
      dbPath: process.env.CODEARTS_BAR_DB,
      useSavedSettings: false,
      format,
      outputPath,
      includeErrors: false,
    });
    assert.equal(exported.ok, true);
    assert.ok(fs.statSync(outputPath).size > 100);
  }
  assert.ok(activationMs < 5000, `extension activation should stay below 5s, got ${activationMs}ms`);
  assert.ok(refreshMs < 3000, `extension refresh command should stay below 3s, got ${refreshMs}ms`);
  const resultFile = process.env.CODEARTS_BAR_EXTENSION_HOST_RESULT;
  if (resultFile) fs.writeFileSync(resultFile, JSON.stringify({ ok: true, activationMs, refreshMs, sessions: sessions.data.total, requests: requests.data.total, vscode: vscode.version }, null, 2), 'utf8');
  console.log(`ok - vscode extension host activation=${activationMs}ms refresh=${refreshMs}ms vscode=${vscode.version}`);
}
module.exports = { run };
