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
  const MAX_BATCH_EXPORT = 500;
  const MAX_BATCH_ARCHIVE = 500;
  const normalizeSession = (value, { requireDbPath = false } = {}) => {
    if (!value || typeof value !== 'object') throw new Error('会话参数无效');
    const id = String(value.id || '').trim();
    if (!id || id.length > 256) throw new Error('会话 ID 无效');
    const dbPath = String(value.dbPath || '').trim();
    if (requireDbPath && !dbPath) throw new Error('会话数据库路径无效');
    if (dbPath.length > 4096) throw new Error('会话数据库路径无效');
    const source = String(value.source || '').trim();
    if (source.length > 64) throw new Error('会话来源无效');
    return { ...value, id, dbPath, source };
  };
  const allowedDbPaths = () => {
    if (typeof localProvider?.listDataSources !== 'function') return null;
    return new Set(localProvider.listDataSources({})
      .map((item) => String(item.dbPath || '').trim().toLowerCase())
      .filter(Boolean));
  };
  const assertAllowedDbPath = (dbPath, allowed = null) => {
    if (!dbPath || typeof localProvider?.listDataSources !== 'function') return;
    const known = allowed || allowedDbPaths();
    if (known?.size && !known.has(dbPath.toLowerCase())) {
      const error = new Error('会话数据库不是当前已发现的数据源');
      error.code = 'SESSION_DB_NOT_ALLOWED';
      throw error;
    }
  };
  const exportFailure = (error) => ({
    ok: false,
    code: String(error?.code || 'SESSION_EXPORT_FAILED'),
    message: String(error?.message || '会话导出失败'),
    retryable: !['SESSION_EXPORT_ID_REQUIRED', 'SESSION_EXPORT_NOT_FOUND', 'SESSION_EXPORT_INTERNAL_SESSION'].includes(error?.code),
  });
  ipcMain.handle('dashboard:openSession', (_event, session) => openSessionDir(session));
  ipcMain.handle('dashboard:openCodeArtsSession', (_event, session) => openCodeArts(session && session.directory));
  ipcMain.handle('dashboard:copySession', (_event, session) => clipboard.writeText(`${session.title || ''}\n${session.id || ''}\n${session.directory || ''}`.trim()));
  ipcMain.handle('dashboard:exportSession', async (event, session, format = 'json', exportOptions = {}) => {
    session = normalizeSession(session);
    assertAllowedDbPath(session.dbPath);
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
    if (Array.isArray(sessions) && sessions.length > MAX_BATCH_EXPORT) throw new Error(`批量导出最多支持 ${MAX_BATCH_EXPORT} 个会话`);
    const selected = Array.isArray(sessions) ? sessions.filter((session) => session?.id).map((session) => normalizeSession(session)) : [];
    selected.forEach((session) => assertAllowedDbPath(session.dbPath));
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
      const exportedSessions = Array.isArray(result.model?.sessions) ? result.model.sessions.length : selected.length;
      return { ok: true, path: result.path, format: result.format, bytes: result.bytes, sessions: exportedSessions };
    } catch (error) { return exportFailure(error); }
  });
  ipcMain.handle('dashboard:openLogs', () => openLogFile());
  ipcMain.handle('dashboard:archiveSessions', async (_event, sessions, archived = true) => {
    if (Array.isArray(sessions) && sessions.length > MAX_BATCH_ARCHIVE) throw new Error(`批量归档最多支持 ${MAX_BATCH_ARCHIVE} 个会话`);
    const selected = Array.isArray(sessions)
      ? sessions.filter((session) => session?.id).map((session) => normalizeSession(session, { requireDbPath: true }))
      : [];
    if (!selected.length) throw new Error('请选择至少一个会话');
    const allowed = allowedDbPaths();
    selected.forEach((session) => assertAllowedDbPath(session.dbPath, allowed));
    const nextArchived = archived !== false;
    const result = await localProvider.archiveSessions({
      sessions: selected.map((session) => ({ id: session.id, source: session.source, dbPath: session.dbPath })),
      archived: nextArchived,
    });
    for (const session of selected) {
      patchSessionInMemory(session, { archived: nextArchived, archivedAt: nextArchived ? result.time || Date.now() : null });
    }
    return result;
  });
  ipcMain.handle('dashboard:archiveSession', async (_event, session, archived = true) => {
    session = normalizeSession(session, { requireDbPath: true });
    assertAllowedDbPath(session.dbPath);
    const nextArchived = archived !== false;
    const result = await localProvider.archiveSession({ dbPath: session.dbPath, id: session.id, archived: nextArchived });
    patchSessionInMemory(session, { archived: nextArchived, archivedAt: nextArchived ? Date.now() : null });
    return result;
  });
  ipcMain.handle('dashboard:renameSession', async (_event, session, title) => {
    session = normalizeSession(session, { requireDbPath: true });
    assertAllowedDbPath(session.dbPath);
    const nextTitle = String(title || '').trim();
    if (nextTitle.length > 200) throw new Error('会话名称最多 200 个字符');
    const result = await localProvider.renameSession({ dbPath: session.dbPath, id: session.id, title: nextTitle });
    if (nextTitle) patchSessionInMemory(session, { title: nextTitle });
    return result;
  });
}

module.exports = { registerSessionIpc };
