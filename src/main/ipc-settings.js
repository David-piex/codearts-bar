'use strict';

function registerSettingsIpc({
  ipcMain,
  loadSettings,
  saveSettings,
  diagnose,
  refreshLight,
  scheduleRefresh,
  scheduleDbWatch,
}) {
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', async (_event, next) => {
    const saved = saveSettings(next);
    scheduleRefresh();
    scheduleDbWatch();
    await refreshLight();
    return saved;
  });
  ipcMain.handle('diagnose:get', async () => diagnose());
  ipcMain.handle('auth:get', async () => ({}));
}

module.exports = { registerSettingsIpc };
