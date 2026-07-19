'use strict';

const assert = require('node:assert/strict');
const { registerSessionIpc } = require('../src/main/ipc-session');

async function main() {
  const handlers = new Map();
  const calls = [];
  let dialogResult = { canceled: false, filePath: 'C:\\exports\\session.xlsx' };
  let exportError = null;
  const owner = { id: 'dashboard' };
  registerSessionIpc({
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    clipboard: { writeText() {} },
    dialog: { async showSaveDialog(receivedOwner, options) { calls.push({ type: 'dialog', receivedOwner, options }); return dialogResult; } },
    BrowserWindow: { fromWebContents(sender) { assert.equal(sender.id, 'renderer'); return owner; } },
    localProvider: {
      safeFileStem(value) { return String(value).replace(/[^a-z0-9-]/gi, '_'); },
      async exportSessionToFile(options) { calls.push({ type: 'export', options }); if (exportError) throw exportError; return { path: options.outputPath, format: options.format, bytes: 321 }; },
      async exportSessionsToFile(options) { calls.push({ type: 'batch-export', options }); if (exportError) throw exportError; return { path: options.outputPath, format: options.format, bytes: 654, model: { sessions: options.sessions.filter((item) => item.id !== 'ses-internal') } }; },
    },
    openSessionDir() {},
    openCodeArts() {},
    openLogFile() {},
    patchSessionInMemory() {},
  });

  const exportHandler = handlers.get('dashboard:exportSession');
  assert.equal(typeof exportHandler, 'function');
  const session = { id: 'ses-1', title: 'Session One', source: 'desktop', dbPath: 'C:\\data\\opencode.db' };
  const result = await exportHandler({ sender: { id: 'renderer' } }, session, 'xlsx');
  assert.deepEqual(result, { ok: true, path: dialogResult.filePath, format: 'xlsx', bytes: 321 });
  assert.equal(calls[0].receivedOwner, owner);
  assert.equal(calls[0].options.defaultPath, 'Session_One.xlsx');
  assert.deepEqual(calls[1].options, {
    sessionId: 'ses-1', source: 'desktop', dbPath: 'C:\\data\\opencode.db', format: 'xlsx', outputPath: dialogResult.filePath,
    includeContent: true, includeReasoning: false, includeToolIO: false, redactPaths: true, includeErrors: true,
  });

  dialogResult = { canceled: true };
  assert.deepEqual(await exportHandler({ sender: { id: 'renderer' } }, session, 'md'), { ok: false, canceled: true });
  assert.equal(calls.filter((call) => call.type === 'export').length, 1, 'canceling must not write an export');

  dialogResult = { canceled: false, filePath: 'C:\\exports\\session.json' };
  await exportHandler({ sender: { id: 'renderer' } }, session, 'csv', { includeReasoning: true, includeToolIO: true, redactPaths: false });
  const fallback = calls.findLast((call) => call.type === 'export').options;
  assert.equal(fallback.format, 'json', 'unsupported renderer formats must fall back to the JSON allowlist entry');
  assert.equal(fallback.includeReasoning, true);
  assert.equal(fallback.includeToolIO, true);
  assert.equal(fallback.redactPaths, false);
  assert.equal(fallback.includeErrors, true);

  exportError = Object.assign(new Error('会话已被删除，请刷新会话列表后重试'), { code: 'SESSION_EXPORT_NOT_FOUND' });
  assert.deepEqual(await exportHandler({ sender: { id: 'renderer' } }, session, 'json'), {
    ok: false,
    code: 'SESSION_EXPORT_NOT_FOUND',
    message: '会话已被删除，请刷新会话列表后重试',
    retryable: false,
  });
  exportError = Object.assign(new Error('请检查目录权限和可用空间'), { code: 'SESSION_EXPORT_WRITE_FAILED' });
  assert.deepEqual(await exportHandler({ sender: { id: 'renderer' } }, session, 'json'), {
    ok: false,
    code: 'SESSION_EXPORT_WRITE_FAILED',
    message: '请检查目录权限和可用空间',
    retryable: true,
  });
  exportError = null;

  dialogResult = { canceled: false, filePath: 'C:\\exports\\sessions.xlsx' };
  const batchHandler = handlers.get('dashboard:exportSessions');
  const second = { id: 'ses-2', title: 'Session Two', source: 'cli', dbPath: 'C:\\data\\cli.db' };
  const internal = { id: 'ses-internal', title: 'Explore internals (@explore subagent)', source: 'desktop', dbPath: 'C:\\data\\opencode.db' };
  const batch = await batchHandler({ sender: { id: 'renderer' } }, [session, internal, second], 'xlsx', {
    includeContent: false, includeToolIO: true, redactPaths: false, includeErrors: false,
  });
  assert.deepEqual(batch, { ok: true, path: dialogResult.filePath, format: 'xlsx', bytes: 654, sessions: 2 });
  const batchCall = calls.findLast((call) => call.type === 'batch-export').options;
  assert.deepEqual(batchCall.sessions, [
    { id: 'ses-1', source: 'desktop', dbPath: 'C:\\data\\opencode.db' },
    { id: 'ses-internal', source: 'desktop', dbPath: 'C:\\data\\opencode.db' },
    { id: 'ses-2', source: 'cli', dbPath: 'C:\\data\\cli.db' },
  ]);
  assert.equal(batchCall.includeContent, false);
  assert.equal(batchCall.includeToolIO, true);
  assert.equal(batchCall.redactPaths, false);
  assert.equal(batchCall.includeErrors, false);
  await assert.rejects(() => batchHandler({ sender: { id: 'renderer' } }, Array.from({ length: 501 }, (_, index) => ({ id: `s-${index}` }))), /最多支持 500/);
  const renameHandler = handlers.get('dashboard:renameSession');
  await assert.rejects(() => renameHandler({}, session, 'x'.repeat(201)), /最多 200/);
  console.log('ok - desktop session export IPC contract');
}

main().catch((error) => { console.error(error); process.exit(1); });
