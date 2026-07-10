'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, shell } = require('electron');

function writePackageSmokeResult(packageSmoke, payload = {}) {
  if (!packageSmoke?.resultPath) return false;
  try {
    fs.mkdirSync(path.dirname(packageSmoke.resultPath), { recursive: true });
    fs.writeFileSync(packageSmoke.resultPath, JSON.stringify({
      ok: true,
      app: 'CodeArts Bar',
      event: 'dashboard-ready',
      version: packageSmoke.version || null,
      userDataIsolated: Boolean(packageSmoke.userDataIsolated),
      userDataName: packageSmoke.userDataName || '',
      time: new Date().toISOString(),
      elapsedMs: Number(packageSmoke.startedAt || 0) ? Date.now() - Number(packageSmoke.startedAt || 0) : null,
      ...payload,
    }, null, 2), 'utf8');
    return true;
  } catch (error) {
    try { packageSmoke.appendLog?.('error', 'package-smoke', error.message, { resultPath: packageSmoke.resultPath }); } catch {}
    return false;
  }
}


function secureWebContents(win, appendLog, scope) {
  if (!win || win.isDestroyed()) return;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(String(url || ''))) shell.openExternal(url).catch(() => {});
    appendLog?.('warn', scope, 'blocked-window-open', { url });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url === current) return;
    event.preventDefault();
    if (/^https?:/i.test(String(url || ''))) shell.openExternal(url).catch(() => {});
    appendLog?.('warn', scope, 'blocked-navigation', { url });
  });
}

function createSettingsWindow({ appDir, appendLog, onClosed }) {
  const win = new BrowserWindow({
    width: 560,
    height: 560,
    title: '码道 Bar 设置',
    icon: path.join(appDir, '..', 'assets', 'codearts-logo.ico'),
    webPreferences: {
      preload: path.join(appDir, 'settings-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  secureWebContents(win, appendLog, 'settings');
  win.loadFile(path.join(appDir, 'settings.html'));
  win.on('closed', () => { if (typeof onClosed === 'function') onClosed(); });
  return win;
}

function createDashboardWindow({ appDir, isQuitting, hideToTray, appendLog, recordCrash, recordRendererError, packageSmoke, onClosed }) {
  const nativeSurface = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 15 }, vibrancy: 'under-window', visualEffectState: 'active', transparent: true, roundedCorners: true }
    : {};
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: '码道 Bar',
    frame: true,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#f7f8fb',
    ...nativeSurface,
    icon: path.join(appDir, '..', 'assets', 'codearts-logo.ico'),
    webPreferences: {
      preload: path.join(appDir, 'dashboard-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  secureWebContents(win, appendLog, 'dashboard');
  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) {
      try { win.setSkipTaskbar(false); } catch {}
      if (packageSmoke?.resultPath) {
        writePackageSmokeResult({ ...packageSmoke, appendLog }, {
          readyToShow: true,
          title: win.getTitle(),
        });
        setTimeout(() => packageSmoke.onReady?.(), 120);
      }
      win.show();
      win.focus();
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (!packageSmoke?.resultPath) return;
    writePackageSmokeResult({ ...packageSmoke, appendLog }, {
      didFinishLoad: true,
      title: win.getTitle(),
    });
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendLog?.('error', 'dashboard', 'did-fail-load', { errorCode, errorDescription, validatedURL });
    console.error('[dashboard] did-fail-load', errorCode, errorDescription, validatedURL);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    appendLog?.('error', 'dashboard', 'render-process-gone', details);
    recordCrash?.('renderer_process_gone', new Error(details?.reason || 'render-process-gone'), details);
    console.error('[dashboard] render-process-gone', details);
  });
  win.webContents.on('unresponsive', () => {
    appendLog?.('warn', 'dashboard', 'unresponsive');
    recordRendererError?.('unresponsive', new Error('Dashboard window became unresponsive'));
    console.error('[dashboard] unresponsive');
  });
  win.loadFile(path.join(appDir, 'dashboard.html'));
  win.on('minimize', (event) => {
    if (isQuitting?.()) return;
    event.preventDefault();
    hideToTray?.();
  });
  win.on('close', (event) => {
    if (!isQuitting?.()) {
      event.preventDefault();
      hideToTray?.();
    }
  });
  win.on('closed', () => { if (typeof onClosed === 'function') onClosed(); });
  return win;
}

function setDashboardLayoutMode(win, mode = 'dashboard') {
  if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
  const compact = mode === 'compact';
  try {
    const targetWidth = compact ? 560 : 1280;
    const targetHeight = compact ? 760 : 860;
    if (compact) win.setMinimumSize(500, 620);
    else win.setMinimumSize(980, 680);
    const [width, height] = win.getSize();
    if (Math.abs(width - targetWidth) > 2 || Math.abs(height - targetHeight) > 2) {
      win.setSize(targetWidth, targetHeight, false);
      win.center();
    }
    return { ok: true, mode: compact ? 'compact' : 'dashboard' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function setDashboardPinned(win, pinned = false) {
  if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
  win.setAlwaysOnTop(Boolean(pinned), 'floating');
  return { ok: true, pinned: Boolean(pinned) };
}

function isDashboardVisible(win) {
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

module.exports = {
  createSettingsWindow,
  createDashboardWindow,
  setDashboardLayoutMode,
  setDashboardPinned,
  isDashboardVisible,
};
