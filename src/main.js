'use strict';

const { app, Tray, shell, clipboard, Notification, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

// The dashboard uses a canvas for the trend chart. Hardware accelerated
// renderer crashes were observed in the portable Windows build (exit code
// 0x80000003), so keep the desktop surface on Electron's stable software path.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
const { getSnapshotWithCache, snapshotToText, errorSnapshot, fmtInt } = require('./codeartsData');
const { loadSettings, saveSettings, watchSettings, closeSettingsStore } = require('./settings');
const { diagnose } = require('./diagnose');
const { notificationEvents } = require('./health');
const localProvider = require('./providers/codeartsLocal');
const { nativeSqliteStatus } = require('./providers/codearts/sqlite');
const { scheduleUsageRollupMaintenance } = require('./providers/codearts/usage-rollup-maintenance');
const dashboardLight = require('./main/dashboard-light');
const trayUi = require('./main/tray');
const mainWindow = require('./main/window');
const { createLogger } = require('./main/logger');
const { createCrashReporter } = require('./main/crash-reporter');
const { createDbWatchService } = require('./main/db-watch-service');
const { createLatestTaskQueue } = require('./main/latest-task-queue');
const { ScoredCache } = require('./core/scored-cache');
const lifecycle = require('./main/lifecycle');
const { registerDashboardIpc } = require('./main/ipc-dashboard');
const { registerSettingsIpc } = require('./main/ipc-settings');
const { registerSessionIpc } = require('./main/ipc-session');
const {
  SESSION_PAGE_SIZE,
  usageStatusFromSummary,
  applyUsageDerivedFields,
  dashboardAggregatePayload,
  usageScopeKeyForPayload,
  isCanonicalDashboardPayload,
  pageBounds,
  matchesPageFilters,
  buildDashboardPreviewSnapshot,
  lightUpdatedAt,
  buildInitialSummarySnapshot,
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
let rollupRefreshTimer = null;
let stopSettingsWatch = null;
const dashboardLightQueues = new Map();
const dashboardSnapshotCache = new ScoredCache(24);
const dashboardUsageSnapshotCache = new ScoredCache(24);
let canonicalSnapshotGeneration = 0;

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
  onDatabaseChange: () => {
    const settings = loadSettings();
    const adapter = process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || !nativeSqliteStatus().available ? 'sql.js' : 'node:sqlite';
    for (const source of localProvider.listDataSources(settings)) {
      scheduleUsageRollupMaintenance(source, {
        adapter,
        minNewRows: 100,
        cooldownMs: 60 * 60 * 1000,
        lastBuildMs: Number(settings.rollupMaintenance?.bySource?.[source.id] || settings.rollupMaintenance?.lastRollupBuildMs || 0),
        delayMs: 50,
        onBuilt: handleUsageRollupBuilt,
      });
    }
  },
});
function handleUsageRollupBuilt({ source, result, completedAt }) {
  const status = String(result?.usageRollup?.status || '');
  if (status.includes('failed')) return;
  const current = loadSettings();
  saveSettings({
    rollupMaintenance: {
      lastRollupBuildMs: completedAt,
      bySource: { ...(current.rollupMaintenance?.bySource || {}), [source.id || 'unknown']: completedAt },
    },
  });
  if (rollupRefreshTimer) clearTimeout(rollupRefreshTimer);
  rollupRefreshTimer = setTimeout(() => {
    rollupRefreshTimer = null;
    if (dashboardWindowVisible()) refreshLightAndPush('rollup-built');
    else refreshTraySummaryOnly();
  }, 150);
  rollupRefreshTimer.unref?.();
}
localProvider.setUsageRollupBuildListener?.(handleUsageRollupBuilt);
localProvider.setUsageRollupStateListener?.((state) => {
  const currentHashes = new Set((localProvider.aggregateRollupState?.(localProvider.listDataSources(loadSettings()))?.sources || []).map((item) => item.sourceHash));
  if (state?.sourceHash && currentHashes.size && !currentHashes.has(state.sourceHash)) return;
  if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.webContents.send('dashboard:rollupState', state);
});

function markCanonicalSnapshot(snap) {
  if (!snap?.ok) return snap;
  const scope = { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0 };
  snap.queryScope = scope;
  snap.usageScope = scope;
  return snap;
}
stopSettingsWatch = watchSettings(({ reason } = {}) => {
  if (reason === 'save') return;
  scheduleRefresh();
  dbWatchService.schedule();
  refreshLight({ reason: 'settings-file-change' });
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
  dbWatchService.reschedulePoll();
}
function hideDashboardToTray() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  try { dashboardWindow.setSkipTaskbar(true); } catch {}
  dashboardWindow.hide();
  dbWatchService.reschedulePoll();
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
  if (rollupRefreshTimer) clearTimeout(rollupRefreshTimer);
  rollupRefreshTimer = null;
  localProvider.setUsageRollupBuildListener?.(null);
  localProvider.setUsageRollupStateListener?.(null);
  dbWatchService.cleanup();
  stopSettingsWatch?.();
  closeSettingsStore();
  Promise.resolve(localProvider.closeSqlJsWorker?.()).catch((error) => appendLog('warn', 'cleanup', 'sql.js worker close failed', { message: error.message }));
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
    const generation = ++canonicalSnapshotGeneration;
    const settings = loadSettings();
    const previousLevel = lastSnapshot && lastSnapshot.ok ? lastSnapshot.status.level : null;
    const previousHealth = lastSnapshot && lastSnapshot.ok ? lastSnapshot.health : null;
    try {
      const next = markCanonicalSnapshot(await getSnapshotWithCache(settings));
      applyUsageDerivedFields(next, settings, Number(next.timestamp || Date.now()));
      if (generation !== canonicalSnapshotGeneration) return lastSnapshot;
      lastSnapshot = next;
      lastDashboardSnapshot = buildDashboardPreviewSnapshot(next);
    }
    catch (error) {
      appendLog('error', 'refresh', error.message, { stack: error.stack });
      if (generation !== canonicalSnapshotGeneration) return lastSnapshot;
      lastSnapshot = errorSnapshot(error);
      lastDashboardSnapshot = lastSnapshot;
    }
    updateTray(lastSnapshot);
    if (lastSnapshot.ok && settings.notifyDanger && previousLevel !== 'danger' && lastSnapshot.status.level === 'danger' && Notification.isSupported()) {
      new Notification({ title: '\u7801\u9053 Bar', body: '\u4eca\u65e5 token \u4f7f\u7528\u504f\u9ad8\uff1a' + lastSnapshot.status.label }).show();
    }
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
    const generation = ++canonicalSnapshotGeneration;
    const settings = loadSettings();
    const previousLevel = lastSnapshot && lastSnapshot.ok ? lastSnapshot.status?.level : null;
    const previousHealth = lastSnapshot && lastSnapshot.ok ? lastSnapshot.health : null;
    try {
      const next = options.summaryOnly === true
        ? await buildInitialSummarySnapshot({ timestamp: Date.now(), ...options })
        : await buildInitialLightSnapshot({ timestamp: Date.now(), ...options });
      if (generation !== canonicalSnapshotGeneration) return lastSnapshot;
      lastSnapshot = next;
      lastDashboardSnapshot = next;
    } catch (error) {
      appendLog('warn', 'refresh:light-initial', error.message, { stack: error.stack });
      try {
        const next = markCanonicalSnapshot(await getSnapshotWithCache(settings));
        applyUsageDerivedFields(next, settings, Number(next.timestamp || Date.now()));
        if (generation !== canonicalSnapshotGeneration) return lastSnapshot;
        lastSnapshot = next;
        lastDashboardSnapshot = buildDashboardPreviewSnapshot(next);
      } catch (fullError) {
        appendLog('error', 'refresh', fullError.message, { stack: fullError.stack });
        if (generation !== canonicalSnapshotGeneration) return lastSnapshot;
        lastSnapshot = errorSnapshot(fullError);
        lastDashboardSnapshot = lastSnapshot;
      }
    }
    updateTray(lastSnapshot);
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
  const generation = canonicalSnapshotGeneration;
  try {
    const summary = await localProvider.getSummary(dashboardAggregatePayload({ timestamp }));
    if (summary?.ok && summary.usage) {
      if (generation !== canonicalSnapshotGeneration) return lastSnapshot;
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
function warmupSqlJsFallback() {
  if (process.env.CODEARTS_BAR_DISABLE_SQLJS_WARMUP === '1') return;
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1' && nativeSqliteStatus().available) return;
  const maxBytes = 50 * 1024 * 1024;
  const sources = localProvider.listDataSources(loadSettings());
  let totalBytes = 0;
  for (const source of sources) {
    try { totalBytes += fs.statSync(source.dbPath).size; }
    catch { return; }
  }
  if (!sources.length || totalBytes <= 0 || totalBytes >= maxBytes) return;
  Promise.resolve(localProvider.warmupSqlJsWorker?.({ timeoutMs: 30000 }))
    .catch((error) => appendLog('warn', 'sqljs:warmup', error.message));
}
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = mainWindow.createSettingsWindow({ appDir: __dirname, appendLog, onClosed: () => { settingsWindow = null; } });
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
    clearRendererError: crashReporter.clearRendererError,
    packageSmoke: process.env.CODEARTS_BAR_PACKAGE_SMOKE === '1' && packageSmokeResultPath ? {
      resultPath: packageSmokeResultPath,
      startedAt: packageSmokeStartedAt,
      version: app.getVersion(),
      userDataIsolated: Boolean(process.env.CODEARTS_BAR_SMOKE_USER_DATA),
      userDataName: path.basename(app.getPath('userData') || ''),
      stableMs: 5000,
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

function dashboardTaskScopeKey(payload = {}) {
  return JSON.stringify({
    usage: usageScopeKeyForPayload(payload),
    query: String(payload.query || ''),
    sessionQuery: String(payload.sessionQuery || ''),
    status: String(payload.status || 'active'),
    project: String(payload.project || 'all'),
    bucketMs: Number(payload.bucketMs || 0),
  });
}

function cacheDashboardSnapshot(payload, value) {
  if (!value?.ok || isCanonicalDashboardPayload(payload)) return;
  const key = dashboardTaskScopeKey(payload);
  dashboardSnapshotCache.set(key, value);
  const usageKey = usageScopeKeyForPayload(payload);
  dashboardUsageSnapshotCache.set(usageKey, value);
}

function getDashboardSnapshotForPayload(payload = {}) {
  if (isCanonicalDashboardPayload(payload)) return lastDashboardSnapshot || (lastSnapshot?.ok ? buildDashboardPreviewSnapshot(lastSnapshot) : lastSnapshot);
  return dashboardSnapshotCache.get(dashboardTaskScopeKey(payload))
    || dashboardUsageSnapshotCache.get(usageScopeKeyForPayload(payload))
    || null;
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
  const scopeKey = dashboardTaskScopeKey(payload);
  let queue = dashboardLightQueues.get(scopeKey);
  if (!queue) {
    queue = createLatestTaskQueue(async (nextPayload, isSuperseded) => {
      if (!lastSnapshot?.ok) await refreshLight({ reason: 'dashboard-base' });
      const canonical = isCanonicalDashboardPayload(nextPayload);
      const base = canonical
        ? lastSnapshot
        : (getDashboardSnapshotForPayload(nextPayload) || lastSnapshot);
      if (!base?.ok) return base;
      const commitGeneration = canonical ? ++canonicalSnapshotGeneration : 0;
      // Range/source/model snapshots must keep the top-level quota/status from
      // the live canonical snapshot. Canonical requests derive those fields
      // from their own current aggregate instead.
      const canonicalReference = canonical ? null : lastSnapshot;
      const { fullSnap, dashboardSnap } = await buildDashboardLightPair(base, nextPayload, canonicalReference);
      // Return this task's own result to its caller. Only cache/commit it when it
      // is still the newest task for the same scope.
      if (isSuperseded()) return dashboardSnap;
      if (canonical) {
        if (commitGeneration === canonicalSnapshotGeneration) {
          lastSnapshot = fullSnap;
          lastDashboardSnapshot = dashboardSnap;
        }
      } else {
        cacheDashboardSnapshot(nextPayload, dashboardSnap);
      }
      return dashboardSnap;
    });
    dashboardLightQueues.set(scopeKey, queue);
  }
  return queue.enqueue(payload).finally(() => {
    setTimeout(() => {
      if (dashboardLightQueues.get(scopeKey) === queue && !queue.busy()) dashboardLightQueues.delete(scopeKey);
    }, 0);
  });
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
    clearRendererError: crashReporter.clearRendererError,
  getLastSnapshot: () => lastSnapshot,
  getLastDashboardSnapshot: () => lastDashboardSnapshot,
  getDashboardSnapshotForPayload,
  buildInitialSummarySnapshot: async (payload) => {
    if (!lastSnapshot?.ok) await refreshLight({ summaryOnly: true, reason: 'dashboard-canonical-base' });
    return buildInitialSummarySnapshot(payload, lastSnapshot);
  },
  buildInitialLightSnapshot: async (payload) => {
    if (!lastSnapshot?.ok) await refreshLight({ reason: 'dashboard-canonical-base' });
    return buildInitialLightSnapshot(payload, lastSnapshot);
  },
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
registerSessionIpc({ ipcMain, clipboard, dialog, BrowserWindow, localProvider, openSessionDir, openCodeArts, openLogFile, patchSessionInMemory });

if (lifecycle.requestSingleInstance(app, { refreshLight, openDashboardWindow })) {
  app.whenReady().then(() => {
    app.setAppUserModelId('CodeArtsBar');
    tray = new Tray(makeTrayIcon(null));
    tray.setToolTip('码道 Bar 正在启动');
    tray.on('click', () => restoreDashboardWindow());
    tray.on('double-click', () => restoreDashboardWindow());
    tray.on('right-click', () => showTrayMenu());
    refreshTrayMenu();
    warmupSqlJsFallback();
    refreshLight({ summaryOnly: true, reason: 'startup' });
    scheduleRefresh();
    scheduleDbWatch();
    if (process.env.CODEARTS_BAR_PACKAGE_SMOKE === '1' || process.argv.includes('--open-dashboard')) {
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
