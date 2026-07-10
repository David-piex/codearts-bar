'use strict';

function registerSessionIpc({
  ipcMain,
  clipboard,
  localProvider,
  openSessionDir,
  openCodeArts,
  openLogFile,
  patchSessionInMemory,
}) {
  ipcMain.handle('dashboard:openSession', (_event, session) => openSessionDir(session));
  ipcMain.handle('dashboard:openCodeArtsSession', (_event, session) => openCodeArts(session && session.directory));
  ipcMain.handle('dashboard:copySession', (_event, session) => clipboard.writeText(`${session.title || ''}\n${session.id || ''}\n${session.directory || ''}`.trim()));
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
