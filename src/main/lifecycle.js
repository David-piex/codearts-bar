'use strict';

function requestSingleInstance(app, { refreshLight, openDashboardWindow } = {}) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.exit(0);
    return false;
  }
  app.on('second-instance', () => {
    refreshLight?.();
    openDashboardWindow?.();
  });
  return true;
}

function registerQuitHandlers(app, {
  isQuitting,
  markQuitting,
  cleanupRuntime,
  getForcedExitTimer,
  setForcedExitTimer,
} = {}) {
  app.on('before-quit', () => {
    markQuitting?.();
    app.isQuitting = true;
    cleanupRuntime?.();
    if (!getForcedExitTimer?.()) {
      const timer = setTimeout(() => app.exit(0), 800);
      timer.unref?.();
      setForcedExitTimer?.(timer);
    }
  });
  app.on('window-all-closed', (event) => {
    if (!isQuitting?.()) event.preventDefault();
  });
  app.on('will-quit', () => cleanupRuntime?.());
}

module.exports = { requestSingleInstance, registerQuitHandlers };
