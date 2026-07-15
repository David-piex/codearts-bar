'use strict';

function registerSessionIpc({
  ipcMain,
  clipboard,
  dialog,
  BrowserWindow,
  localProvider,
  openSessionDir,
  openCodeArts,
  openLogFile,
  patchSessionInMemory,
}) {
  const exportFailure = (error) => ({
    ok: false,
    code: String(error?.code || 'SESSION_EXPORT_FAILED'),
    message: String(error?.message || '会话导出失败'),
    retryable: !['SESSION_EXPORT_ID_REQUIRED', 'SESSION_EXPORT_NOT_FOUND'].includes(error?.code),
  });
  ipcMain.handle('dashboard:openSession', (_event, session) => openSessionDir(session));
  ipcMain.handle('dashboard:openCodeArtsSession', (_event, session) => openCodeArts(session && session.directory));
  ipcMain.handle('dashboard:copySession', (_event, session) => clipboard.writeText(`${session.title || ''}\n${session.id || ''}\n${session.directory || ''}`.trim()));
  ipcMain.handle('dashboard:exportSession', async (event, session, format = 'json', exportOptions = {}) => {
    const requestedFormat = String(format || 'json').toLowerCase();
    const normalizedFormat = ['json', 'md', 'xlsx'].includes(requestedFormat) ? requestedFormat : 'json';
    const extension = normalizedFormat === 'md' ? 'md' : normalizedFormat === 'xlsx' ? 'xlsx' : 'json';
    const labels = { json: 'JSON', md: 'Markdown', xlsx: 'Excel' };
    const defaultName = `${localProvider.safeFileStem(session?.title || session?.id || 'codearts-session')}.${extension}`;
    const owner = BrowserWindow?.fromWebContents?.(event.sender) || undefined;
    const choice = await dialog.showSaveDialog(owner, {
      title: `导出会话为 ${labels[normalizedFormat] || labels.json}`,
      defaultPath: defaultName,
      filters: [{ name: labels[normalizedFormat] || labels.json, extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    try {
      const result = await localProvider.exportSessionToFile({
        sessionId: session?.id,
        source: session?.source,
        dbPath: session?.dbPath,
        format: normalizedFormat,
        outputPath: choice.filePath,
        includeContent: exportOptions.includeContent !== false,
        includeReasoning: exportOptions.includeReasoning === true,
        includeToolIO: exportOptions.includeToolIO === true,
        redactPaths: exportOptions.redactPaths !== false,
        includeErrors: exportOptions.includeErrors !== false,
      });
      return { ok: true, path: result.path, format: result.format, bytes: result.bytes };
    } catch (error) { return exportFailure(error); }
  });
  ipcMain.handle('dashboard:exportSessions', async (event, sessions, format = 'json', exportOptions = {}) => {
    const selected = Array.isArray(sessions) ? sessions.filter((session) => session?.id) : [];
    if (!selected.length) throw new Error('请选择至少一个要导出的会话');
    const requestedFormat = String(format || 'json').toLowerCase();
    const normalizedFormat = ['json', 'md', 'xlsx'].includes(requestedFormat) ? requestedFormat : 'json';
    const extension = normalizedFormat === 'md' ? 'md' : normalizedFormat === 'xlsx' ? 'xlsx' : 'json';
    const labels = { json: 'JSON', md: 'Markdown', xlsx: 'Excel' };
    const owner = BrowserWindow?.fromWebContents?.(event.sender) || undefined;
    const choice = await dialog.showSaveDialog(owner, {
      title: `批量导出 ${selected.length} 个会话为 ${labels[normalizedFormat]}`,
      defaultPath: `codearts-sessions-${selected.length}.${extension}`,
      filters: [{ name: labels[normalizedFormat], extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    try {
      const result = await localProvider.exportSessionsToFile({
        sessions: selected.map((session) => ({ id: session.id, source: session.source, dbPath: session.dbPath })),
        format: normalizedFormat,
        outputPath: choice.filePath,
        includeContent: exportOptions.includeContent !== false,
        includeReasoning: exportOptions.includeReasoning === true,
        includeToolIO: exportOptions.includeToolIO === true,
        redactPaths: exportOptions.redactPaths !== false,
        includeErrors: exportOptions.includeErrors !== false,
      });
      return { ok: true, path: result.path, format: result.format, bytes: result.bytes, sessions: selected.length };
    } catch (error) { return exportFailure(error); }
  });
  ipcMain.handle('dashboard:openLogs', () => openLogFile());
  ipcMain.handle('dashboard:archiveSession', async (_event, session, archived = true) => {
    const nextArchived = archived !== false;
    const result = await localProvider.archiveSession({ dbPath: session.dbPath, id: session.id, archived: nextArchived });
    patchSessionInMemory(session, { archived: nextArchived, archivedAt: nextArchived ? Date.now() : null });
    return result;
  });
  ipcMain.handle('dashboard:renameSession', async (_event, session, title) => {
    const nextTitle = String(title || '').trim();
    const result = await localProvider.renameSession({ dbPath: session.dbPath, id: session.id, title: nextTitle });
    if (nextTitle) patchSessionInMemory(session, { title: nextTitle });
    return result;
  });
}

module.exports = { registerSessionIpc };
