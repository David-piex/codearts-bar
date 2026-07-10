'use strict';

const { app, Tray, shell, clipboard, Notification, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { getSnapshotWithCache, snapshotToText, errorSnapshot, fmtInt } = require('./codeartsData');
const { loadSettings, saveSettings } = require('./settings');
const { diagnose } = require('./diagnose');
const { notificationEvents } = require('./health');
const localProvider = require('./providers/codeartsLocal');
const dashboardLight = require('./main/dashboard-light');
const trayUi = require('./main/tray');
const mainWindow = require('./main/window');
const { createLogger } = require('./main/logger');
const { createCrashReporter } = require('./main/crash-reporter');
const { createDbWatchService } = require('./main/db-watch-service');
const lifecycle = require('./main/lifecycle');
const { registerDashboardIpc } = require('./main/ipc-dashboard');
const { registerSettingsIpc } = require('./main/ipc-settings');
const { registerSessionIpc } = require('./main/ipc-session');
const {
  SESSION_PAGE_SIZE,
  usageStatusFromSummary,
  applyUsageDerivedFields,
  dashboardAggregatePayload,
  pageBounds,
  matchesPageFilters,
  buildDashboardPreviewSnapshot,
  lightUpdatedAt,
  buildInitialLightSnapshot,
  buildDashboardLightPair,
} = dashboardLight;

let tray = null;
let lastSnapshot = null;
let lastDashboardSnapshot = null;
let refreshTimer = null;
let settingsWindow = null;
let dashboardWindow = null;
let isQuitting = false;
let forcedExitTimer = null;
let trayHintShown = false;
let fullRefreshInFlight = null;
let lightRefreshInFlight = null;

const trayAssetsDir = path.join(__dirname, '..', 'assets');
const packageSmokeStartedAt = Date.now();
const packageSmokeResultPath = process.env.CODEARTS_BAR_PACKAGE_SMOKE_RESULT || '';
if (process.env.CODEARTS_BAR_SMOKE_USER_DATA) {
  try {
    fs.mkdirSync(process.env.CODEARTS_BAR_SMOKE_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.CODEARTS_BAR_SMOKE_USER_DATA);
  } catch {}
}
const { logPath, appendLog, openLogFile } = createLogger({ app, shell });
const crashReporter = createCrashReporter({ app, appendLog });
crashReporter.install();
const dbWatchService = createDbWatchService({
  fs,
  loadSettings,
  localProvider,
  dashboardWindowVisible,
  refreshLightAndPush,
  refreshTraySummaryOnly,
});

function trayActions() {
  return { openDashboardWindow, refreshTraySummaryOnly, openLogFile, openSettingsWindow, openReleaseFolder, openCodeArts, quitApp };
}
function makeTrayIcon(snapshot) {
  return trayUi.makeTrayIcon(snapshot, { assetsDir: trayAssetsDir });
}
function updateTray(snapshot = lastSnapshot) {
  trayUi.updateTray(tray, snapshot, { fmtInt, actions: trayActions(), assetsDir: trayAssetsDir });
}
function refreshTrayMenu() {
  return trayUi.refreshTrayMenu(tray, lastSnapshot, { fmtInt, actions: trayActions(), assetsDir: trayAssetsDir });
}
function showTrayMenu() {
  trayUi.showTrayMenu(tray, lastSnapshot, { fmtInt, actions: trayActions(), assetsDir: trayAssetsDir });
}
function openReleaseFolder() {
  return shell.openPath(path.join(__dirname, '..', 'dist'));
}

function restoreDashboardWindow() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    openDashboardWindow();
    return;
  }
  try { dashboardWindow.setSkipTaskbar(false); } catch {}
  if (dashboardWindow.isMinimized()) dashboardWindow.restore();
  dashboardWindow.show();
  dashboardWindow.focus();
}
function hideDashboardToTray() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  try { dashboardWindow.setSkipTaskbar(true); } catch {}
  dashboardWindow.hide();
  refreshTrayMenu();
  if (!trayHintShown && Notification.isSupported()) {
    trayHintShown = true;
    new Notification({ title: '码道 Bar', body: '已最小化到托盘，右键托盘图标可打开菜单。' }).show();
  }
}

function cleanupRuntime() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  dbWatchService.cleanup();
  if (tray) {
    try { tray.destroy(); } catch {}
    tray = null;
  }
}

function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  app.isQuitting = true;
  crashReporter.markCleanExit();
  cleanupRuntime();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.removeAllListeners('close');
      win.destroy();
    } catch {}
  }
  app.quit();
  forcedExitTimer = setTimeout(() => {
    if (isQuitting) app.exit(0);
  }, 800);
  forcedExitTimer.unref?.();
}

async function refreshNow() {
  if (fullRefreshInFlight) return fullRefreshInFlight;
  fullRefreshInFlight = (async () => {
    const previousLevel = lastSnapshot && lastSnapshot.ok ? lastSnapshot.status.level : null;
    const previousHealth = lastSnapshot && lastSnapshot.ok ? lastSnapshot.health : null;
    try {
      lastSnapshot = await getSnapshotWithCache(loadSettings());
      applyUsageDerivedFields(lastSnapshot, loadSettings(), Number(lastSnapshot.timestamp || Date.now()));
      lastDashboardSnapshot = buildDashboardPreviewSnapshot(lastSnapshot);
    }
    catch (error) { appendLog('error', 'refresh', error.message, { stack: error.stack }); lastSnapshot = errorSnapshot(error); lastDashboardSnapshot = lastSnapshot; }
    updateTray(lastSnapshot);
    if (lastSnapshot.ok && loadSettings().notifyDanger && previousLevel !== 'danger' && lastSnapshot.status.level === 'danger' && Notification.isSupported()) {
      new Notification({ title: '\u7801\u9053 Bar', body: '\u4eca\u65e5 token \u4f7f\u7528\u504f\u9ad8\uff1a' + lastSnapshot.status.label }).show();
    }
    const settings = loadSettings();
    if (lastSnapshot.ok && settings.notifyHealth && Notification.isSupported()) {
      for (const issue of notificationEvents(previousHealth, lastSnapshot.health).slice(0, 2)) {
        new Notification({ title: '\u7801\u9053 Bar - ' + issue.level, body: issue.message }).show();
      }
    }
    pushDashboard();
    refreshOfficialInBackground();
    return lastSnapshot;
  })().finally(() => { fullRefreshInFlight = null; });
  return fullRefreshInFlight;
}

async function refreshLight(options = {}) {
  if (lightRefreshInFlight) return lightRefreshInFlight;
  lightRefreshInFlight = (async () => {
    const previousLevel = lastSnapshot && lastSnapshot.ok ? lastSnapshot.status?.level : null;
    const previousHealth = lastSnapshot && lastSnapshot.ok ? lastSnapshot.health : null;
    try {
      const next = await buildInitialLightSnapshot({ timestamp: Date.now(), ...options });
      lastSnapshot = next;
      lastDashboardSnapshot = next;
    } catch (error) {
      appendLog('warn', 'refresh:light-initial', error.message, { stack: error.stack });
      try {
        lastSnapshot = await getSnapshotWithCache(loadSettings());
        applyUsageDerivedFields(lastSnapshot, loadSettings(), Number(lastSnapshot.timestamp || Date.now()));
        lastDashboardSnapshot = buildDashboardPreviewSnapshot(lastSnapshot);
      } catch (fullError) {
        appendLog('error', 'refresh', fullError.message, { stack: fullError.stack });
        lastSnapshot = errorSnapshot(fullError);
        lastDashboardSnapshot = lastSnapshot;
      }
    }
    updateTray(lastSnapshot);
    const settings = loadSettings();
    if (lastSnapshot?.ok && settings.notifyDanger && previousLevel !== 'danger' && lastSnapshot.status?.level === 'danger' && Notification.isSupported()) {
      new Notification({ title: '\u7801\u9053 Bar', body: '\u4eca\u65e5 token \u4f7f\u7528\u504f\u9ad8\uff1a' + lastSnapshot.status.label }).show();
    }
    if (lastSnapshot?.ok && settings.notifyHealth && Notification.isSupported()) {
      for (const issue of notificationEvents(previousHealth, lastSnapshot.health).slice(0, 2)) {
        new Notification({ title: '\u7801\u9053 Bar - ' + issue.level, body: issue.message }).show();
      }
    }
    pushDashboard();
    return lastSnapshot;
  })().finally(() => { lightRefreshInFlight = null; });
  return lightRefreshInFlight;
}

async function refreshTraySummaryOnly() {
  if (!lastSnapshot || !lastSnapshot.ok) return refreshLight();
  const previousLevel = lastSnapshot.status?.level || null;
  const settings = loadSettings();
  const timestamp = Date.now();
  try {
    const summary = await localProvider.getSummary(dashboardAggregatePayload({ timestamp }));
    if (summary?.ok && summary.usage) {
      lastSnapshot = {
        ...lastSnapshot,
        timestamp,
        updatedAt: lightUpdatedAt(timestamp),
        usage: summary.usage,
        sources: summary.sources || lastSnapshot.sources || [],
        config: { ...(lastSnapshot.config || {}), dailyLimit: Number(settings.dailyLimit || process.env.CODEARTS_BAR_DAILY_LIMIT || 200000), windowHours: Number(settings.windowHours || process.env.CODEARTS_BAR_WINDOW_HOURS || 24) },
        status: { ...(lastSnapshot.status || {}), ...usageStatusFromSummary(summary.usage, settings) },
        freshness: { stale: false, source: 'summary', ageMs: 0 },
      };
      applyUsageDerivedFields(lastSnapshot, settings, timestamp);
    }
  } catch (error) {
    appendLog('warn', 'tray:summary', error.message);
  }
  updateTray(lastSnapshot);
  if (lastSnapshot?.ok && settings.notifyDanger && previousLevel !== 'danger' && lastSnapshot.status?.level === 'danger' && Notification.isSupported()) {
    new Notification({ title: '\u7801\u9053 Bar', body: `\u4eca\u65e5 token \u4f7f\u7528\u504f\u9ad8\uff1a${lastSnapshot.status.label}` }).show();
  }
  return lastSnapshot;
}
async function refreshLightAndPush(reason = 'watch') {
  if (!lastSnapshot || !lastSnapshot.ok) return refreshLight({ reason });
  try {
    await buildDashboardLightSnapshot({ reason, timestamp: Date.now() });
  } catch (error) {
    appendLog('warn', 'refresh:light', error.message, { reason });
    return refreshTraySummaryOnly();
  }
  updateTray(lastSnapshot);
  pushDashboard();
  return lastSnapshot;
}
function dashboardWindowVisible() {
  return mainWindow.isDashboardVisible(dashboardWindow);
}

function openSessionDir(session) {
  if (session && session.directory && fs.existsSync(session.directory)) return shell.openPath(session.directory);
  const dir = path.dirname((lastSnapshot && lastSnapshot.dbPath) || path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'opencode.db'));
  return shell.openPath(dir);
}
function openCodeArts(targetDir) {
  const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'CodeArts Agent', 'codearts-agent.exe');
  const args = [];
  if (targetDir && fs.existsSync(targetDir)) args.push(targetDir);
  if (fs.existsSync(exe)) { const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }); child.unref(); return; }
  shell.openExternal('https://codearts.huaweicloud.com/');
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshTraySummaryOnly, loadSettings().refreshMs);
}
function triggerRefreshSoon(reason = 'watch') {
  return dbWatchService.triggerRefreshSoon(reason);
}
function scheduleDbWatch() {
  return dbWatchService.schedule();
}
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = mainWindow.createSettingsWindow({ appDir: __dirname, onClosed: () => { settingsWindow = null; } });
}
function openDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) { restoreDashboardWindow(); return; }
  dashboardWindow = mainWindow.createDashboardWindow({
    appDir: __dirname,
    isQuitting: () => isQuitting,
    hideToTray: hideDashboardToTray,
    appendLog,
    recordCrash: crashReporter.recordCrash,
    recordRendererError: crashReporter.recordRendererError,
    packageSmoke: process.env.CODEARTS_BAR_PACKAGE_SMOKE === '1' && packageSmokeResultPath ? {
      resultPath: packageSmokeResultPath,
      startedAt: packageSmokeStartedAt,
      version: app.getVersion(),
      userDataIsolated: Boolean(process.env.CODEARTS_BAR_SMOKE_USER_DATA),
      userDataName: path.basename(app.getPath('userData') || ''),
      onReady: quitApp,
    } : null,
    onClosed: () => { dashboardWindow = null; },
  });
}
function setDashboardLayoutMode(mode = 'dashboard') {
  return mainWindow.setDashboardLayoutMode(dashboardWindow, mode);
}
function setDashboardPinned(pinned = false) {
  return mainWindow.setDashboardPinned(dashboardWindow, pinned);
}
function pushDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed() && (lastDashboardSnapshot || lastSnapshot)) dashboardWindow.webContents.send('dashboard:snapshot', lastDashboardSnapshot || lastSnapshot);
}
function sameSessionIdentity(a = {}, b = {}) {
  if (!a || !b || !a.id || !b.id || String(a.id) !== String(b.id)) return false;
  if (a.dbPath && b.dbPath && String(a.dbPath) !== String(b.dbPath)) return false;
  if (a.source && b.source && String(a.source) !== String(b.source)) return false;
  return true;
}
function patchSessionInMemory(session, patch = {}) {
  for (const snap of [lastSnapshot, lastDashboardSnapshot]) {
    if (!snap || !snap.ok || !Array.isArray(snap.sessions)) continue;
    snap.sessions = snap.sessions.map((item) => sameSessionIdentity(item, session) ? { ...item, ...patch } : item);
  }
}
async function refreshOfficialInBackground() {
  return;
}
registerSettingsIpc({ ipcMain, loadSettings, saveSettings, diagnose, refreshLight, scheduleRefresh, scheduleDbWatch });

async function buildDashboardLightSnapshot(payload = {}) {
  if (!lastSnapshot || !lastSnapshot.ok) {
    await refreshLight(payload);
    return lastDashboardSnapshot || lastSnapshot;
  }
  const { fullSnap, dashboardSnap } = await buildDashboardLightPair(lastSnapshot, payload);
  lastSnapshot = fullSnap;
  lastDashboardSnapshot = dashboardSnap;
  return dashboardSnap;
}

registerDashboardIpc({
  ipcMain,
  app,
  path,
  localProvider,
  appendLog,
  logPath,
  getCrashState: crashReporter.getCrashState,
  recordRendererError: crashReporter.recordRendererError,
  getLastSnapshot: () => lastSnapshot,
  getLastDashboardSnapshot: () => lastDashboardSnapshot,
  buildInitialLightSnapshot,
  buildDashboardPreviewSnapshot,
  buildDashboardLightSnapshot,
  refreshNow,
  openSettingsWindow,
  setDashboardLayoutMode,
  setDashboardPinned,
  dashboardAggregatePayload,
  pageBounds,
  matchesPageFilters,
  errorSnapshot,
  SESSION_PAGE_SIZE,
});
registerSessionIpc({ ipcMain, clipboard, localProvider, openSessionDir, openCodeArts, openLogFile, patchSessionInMemory });

if (lifecycle.requestSingleInstance(app, { refreshLight, openDashboardWindow })) {
  app.whenReady().then(() => {
    app.setAppUserModelId('CodeArtsBar');
    tray = new Tray(makeTrayIcon(null));
    tray.setToolTip('码道 Bar 正在启动');
    tray.on('click', () => restoreDashboardWindow());
    tray.on('double-click', () => restoreDashboardWindow());
    tray.on('right-click', () => showTrayMenu());
    refreshTrayMenu();
    refreshLight();
    scheduleRefresh();
    scheduleDbWatch();
    if (process.env.CODEARTS_BAR_PACKAGE_SMOKE === '1') {
      openDashboardWindow();
    }
  });
  lifecycle.registerQuitHandlers(app, {
    isQuitting: () => isQuitting,
    markQuitting: () => { isQuitting = true; },
    cleanupRuntime,
    getForcedExitTimer: () => forcedExitTimer,
    setForcedExitTimer: (timer) => { forcedExitTimer = timer; },
  });
}
