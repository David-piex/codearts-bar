'use strict';

const { app, Menu, Tray, nativeImage, shell, clipboard, Notification, BrowserWindow, ipcMain } = require('electron');
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
let dbWatchers = [];
let dbRefreshDebounce = null;
let watchPollTimer = null;
let watchFingerprint = '';
let isQuitting = false;
let forcedExitTimer = null;
let trayHintShown = false;
let fullRefreshInFlight = null;
let lightRefreshInFlight = null;

function colorForLevel(level) { return level === 'danger' ? '#ff4d4f' : level === 'warning' ? '#faad14' : '#16a34a'; }
function makeTrayIcon(snapshot) {
  const size = process.platform === 'win32' ? 32 : 22;
  const logoPath = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'codearts-logo.ico' : 'codearts-tray.png');
  try {
    if (fs.existsSync(logoPath)) {
      const logo = nativeImage.createFromPath(logoPath);
      if (!logo.isEmpty()) return logo.resize({ width: size, height: size });
    }
  } catch {}
  const percent = snapshot && snapshot.ok ? Math.min(100, Math.max(0, snapshot.status.usagePercent || 0)) : 0;
  const label = snapshot && snapshot.ok ? String(Math.round(percent)).padStart(percent >= 100 ? 3 : 2, ' ') : '!';
  const fg = snapshot && snapshot.ok ? colorForLevel(snapshot.status.level) : '#ff4d4f';
  const bg = '#101828';
  const barHeight = Math.max(2, Math.round((percent / 100) * (size - 6)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="7" fill="${bg}"/><rect x="4" y="${size - 4 - barHeight}" width="${size - 8}" height="${barHeight}" rx="2" fill="${fg}" opacity="0.9"/><text x="50%" y="${size <= 22 ? 14 : 19}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="${size <= 22 ? 8 : 11}" font-weight="700" fill="#fff">${label}</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
function menuItem(label, sublabel) { return { label: sublabel ? `${label}    ${sublabel}` : label, enabled: false }; }
function trim(text, max) { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
function traySummaryText(snapshot) {
  if (!snapshot || !snapshot.ok) return snapshot ? `\u7801\u9053 Bar\n${snapshot.error}` : '\u7801\u9053 Bar';
  const u = snapshot.usage || {};
  return [
    `\u7801\u9053 Bar \u00b7 \u4eca\u65e5 ${snapshot.status?.label || '0%'}`,
    `\u66f4\u65b0\uff1a${snapshot.updatedAt}`,
    `\u4eca\u65e5\uff1a${fmtInt(u.today?.total || 0)} token`,
    `24h\uff1a${fmtInt(u.window?.total || 0)} token`,
    `7d\uff1a${fmtInt(u.week?.total || 0)} token`,
  ].join('\n');
}
function updateTray(snapshot = lastSnapshot) {
  if (!tray) return;
  tray.setImage(makeTrayIcon(snapshot));
  tray.setToolTip(snapshot?.ok ? traySummaryText(snapshot) : `\u7801\u9053 Bar\n${snapshot?.error || '\u5c1a\u672a\u5237\u65b0'}`);
  tray.setContextMenu(buildMenu(snapshot));
}
function safeUserDataPath() {
  try { return app.getPath('userData'); } catch { return os.tmpdir(); }
}
function logPath() {
  return path.join(safeUserDataPath(), 'codearts-bar.log');
}
function appendLog(level, scope, message, detail = null) {
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      scope,
      message: String(message || ''),
      detail,
    });
    fs.appendFileSync(logPath(), `${line}\n`, 'utf8');
  } catch {}
}
function openLogFile() {
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    if (!fs.existsSync(logPath())) fs.writeFileSync(logPath(), '', 'utf8');
  } catch {}
  return shell.openPath(logPath());
}
function openReleaseFolder() {
  return shell.openPath(path.join(__dirname, '..', 'dist'));
}

function buildMenu(snapshot) {
  if (!snapshot || !snapshot.ok) {
    return Menu.buildFromTemplate([
      { label: '码道 Bar', enabled: false },
      { type: 'separator' },
      { label: trim(snapshot ? snapshot.error : '尚未刷新', 120), enabled: false },
      { type: 'separator' },
      { label: '打开面板', click: openDashboardWindow },
      { label: '刷新', click: refreshTraySummaryOnly },
      { label: '打开日志', click: openLogFile },
      { type: 'separator' },
      { label: '退出', click: quitApp },
    ]);
  }
  const u = snapshot.usage;
  const template = [
    { label: '码道 Bar', enabled: false },
    { label: `更新：${snapshot.updatedAt}`, enabled: false },
    { type: 'separator' },
    menuItem('今日 Token', `${fmtInt(u.today.total)} · ${u.today.messages} 回复 · ${u.today.errors} 错误`),
    menuItem('24h Token', fmtInt(u.window.total)),
    menuItem('7d Token', fmtInt(u.week.total)),
    menuItem('历史 Token', fmtInt(u.all.total)),
  ];
  template.push({ type: 'separator' });
  template.push({ label: '打开面板', click: openDashboardWindow });
  template.push({ label: '刷新', click: refreshTraySummaryOnly });
  template.push({ label: '设置', click: openSettingsWindow });
  template.push({ label: '打开日志', click: openLogFile });
  template.push({ label: '检查更新 / 安装包', click: openReleaseFolder });
  template.push({ label: '打开码道', click: () => openCodeArts() });
  template.push({ type: 'separator' });
  template.push({ label: '退出', click: quitApp });
  return Menu.buildFromTemplate(template);
}
function refreshTrayMenu() {
  if (!tray) return null;
  const menu = buildMenu(lastSnapshot);
  tray.setContextMenu(menu);
  return menu;
}
function showTrayMenu() {
  if (!tray) return;
  const menu = refreshTrayMenu();
  try { tray.popUpContextMenu(menu || undefined); } catch { tray.popUpContextMenu(); }
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
  if (watchPollTimer) {
    clearInterval(watchPollTimer);
    watchPollTimer = null;
  }
  if (dbRefreshDebounce) {
    clearTimeout(dbRefreshDebounce);
    dbRefreshDebounce = null;
  }
  for (const watcher of dbWatchers) {
    try { watcher.close(); } catch {}
  }
  dbWatchers = [];
  if (tray) {
    try { tray.destroy(); } catch {}
    tray = null;
  }
}

function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  app.isQuitting = true;
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
  return Boolean(dashboardWindow && !dashboardWindow.isDestroyed() && dashboardWindow.isVisible());
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
  if (dbRefreshDebounce) clearTimeout(dbRefreshDebounce);
  dbRefreshDebounce = setTimeout(() => {
    if (dashboardWindowVisible()) refreshLightAndPush(reason);
    else refreshTraySummaryOnly();
  }, reason === 'poll' ? 450 : 700);
}
function targetFingerprint(targets) {
  return targets.map((target) => {
    try {
      const st = fs.statSync(target);
      return `${target}:${st.mtimeMs}:${st.size}`;
    } catch {
      return `${target}:missing`;
    }
  }).join('|');
}
function scheduleDbWatch() {
  for (const w of dbWatchers) { try { w.close(); } catch {} }
  dbWatchers = [];
  if (watchPollTimer) clearInterval(watchPollTimer);
  const targets = localProvider.watchTargets(loadSettings());
  watchFingerprint = targetFingerprint(targets);
  for (const target of targets) {
    try {
      if (!fs.existsSync(target)) continue;
      const watcher = fs.watch(target, { persistent: false }, () => {
        triggerRefreshSoon('fswatch');
      });
      dbWatchers.push(watcher);
    } catch {}
  }
  watchPollTimer = setInterval(() => {
    const next = targetFingerprint(targets);
    if (next !== watchFingerprint) {
      watchFingerprint = next;
      triggerRefreshSoon('poll');
    }
  }, 1000);
}
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ width: 560, height: 560, title: '码道 Bar 设置', icon: path.join(__dirname, '..', 'assets', 'codearts-logo.ico'), webPreferences: { nodeIntegration: true, contextIsolation: false } });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}
function openDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) { restoreDashboardWindow(); return; }
  const nativeSurface = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 15 }, vibrancy: 'under-window', visualEffectState: 'active', transparent: true, roundedCorners: true }
    : {};
  dashboardWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: '\u7801\u9053 Bar',
    frame: true,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#f7f8fb',
    ...nativeSurface,
    icon: path.join(__dirname, '..', 'assets', 'codearts-logo.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  dashboardWindow.setMenuBarVisibility(false);
  dashboardWindow.once('ready-to-show', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      try { dashboardWindow.setSkipTaskbar(false); } catch {}
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  });
  dashboardWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendLog('error', 'dashboard', 'did-fail-load', { errorCode, errorDescription, validatedURL });
    console.error('[dashboard] did-fail-load', errorCode, errorDescription, validatedURL);
  });
  dashboardWindow.webContents.on('render-process-gone', (_event, details) => {
    appendLog('error', 'dashboard', 'render-process-gone', details);
    console.error('[dashboard] render-process-gone', details);
  });
  dashboardWindow.webContents.on('unresponsive', () => {
    appendLog('warn', 'dashboard', 'unresponsive');
    console.error('[dashboard] unresponsive');
  });
  dashboardWindow.loadFile(path.join(__dirname, 'dashboard.html'));
  dashboardWindow.on('minimize', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideDashboardToTray();
  });
  dashboardWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); hideDashboardToTray(); } });
  dashboardWindow.on('closed', () => { dashboardWindow = null; });
}
function setDashboardLayoutMode(mode = 'dashboard') {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return { ok: false, reason: 'no-window' };
  const compact = mode === 'compact';
  try {
    const targetWidth = compact ? 560 : 1280;
    const targetHeight = compact ? 760 : 860;
    if (compact) {
      dashboardWindow.setMinimumSize(500, 620);
    } else {
      dashboardWindow.setMinimumSize(980, 680);
    }
    const [width, height] = dashboardWindow.getSize();
    if (Math.abs(width - targetWidth) > 2 || Math.abs(height - targetHeight) > 2) {
      dashboardWindow.setSize(targetWidth, targetHeight, false);
      dashboardWindow.center();
    }
    return { ok: true, mode: compact ? 'compact' : 'dashboard' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
function setDashboardPinned(pinned = false) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return { ok: false, reason: 'no-window' };
  dashboardWindow.setAlwaysOnTop(Boolean(pinned), 'floating');
  return { ok: true, pinned: Boolean(pinned) };
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
function paginateSnapshotList(list, payload = {}) {
  const { limit, offset } = pageBounds(payload);
  const filtered = (list || []).filter((item) => matchesPageFilters(item, payload));
  return {
    ok: true,
    limit,
    offset,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    items: filtered.slice(offset, offset + limit),
    snapshotTimestamp: lastSnapshot?.timestamp || 0,
  };
}
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', async (_event, next) => { const saved = saveSettings(next); scheduleRefresh(); scheduleDbWatch(); await refreshLight(); return saved; });
ipcMain.handle('diagnose:get', async () => diagnose());
ipcMain.handle('auth:get', async () => ({}));
ipcMain.handle('dashboard:getSnapshot', async (_event, payload = {}) => {
  if (!lastSnapshot || !lastSnapshot.ok) return lastDashboardSnapshot || lastSnapshot || await buildInitialLightSnapshot(payload);
  if (payload && Object.keys(payload).length) return buildDashboardLightSnapshot(payload);
  return lastDashboardSnapshot || buildDashboardPreviewSnapshot(lastSnapshot);
});
ipcMain.handle('dashboard:getRequestsPage', async (_event, payload = {}) => {
  try { return await localProvider.getRequestsPage(payload); }
  catch (error) {
    appendLog('warn', 'dashboard:getRequestsPage', error.message, { payload });
    const page = paginateSnapshotList((lastSnapshot && lastSnapshot.requestLog) || [], payload);
    page.fallback = 'snapshot';
    page.error = error.message;
    return page;
  }
});
ipcMain.handle('dashboard:getSessionRequestsPage', async (_event, payload = {}) => {
  try { return await localProvider.getSessionRequestsPage(payload); }
  catch (error) {
    appendLog('warn', 'dashboard:getSessionRequestsPage', error.message, { payload });
    const sessionId = String(payload.sessionId || '').trim();
    const source = String(payload.source || 'all').toLowerCase();
    const filtered = ((lastSnapshot && lastSnapshot.requestLog) || []).filter((item) => {
      if (sessionId && item.sessionId !== sessionId) return false;
      if (source && source !== 'all' && String(item.source || '').toLowerCase() !== source) return false;
      return true;
    });
    const page = paginateSnapshotList(filtered, payload);
    page.fallback = 'snapshot';
    page.error = error.message;
    return page;
  }
});
ipcMain.handle('dashboard:getSessionsPage', async (_event, payload = {}) => {
  try { return await localProvider.getSessionsPage(payload); }
  catch (error) {
    appendLog('warn', 'dashboard:getSessionsPage', error.message, { payload });
    const page = paginateSnapshotList((lastSnapshot && lastSnapshot.sessions) || [], payload);
    page.fallback = 'snapshot';
    page.error = error.message;
    return page;
  }
});

function snapshotUsageFallback(scope) {
  const snap = lastSnapshot || null;
  if (!snap || !snap.ok) return null;
  if (scope === 'summary') return { ok: true, timestamp: snap.timestamp || 0, usage: snap.usage || {}, sources: snap.sources || [], fallback: 'snapshot' };
  if (scope === 'trend') return { ok: true, timestamp: snap.timestamp || 0, buckets: snap.trends?.hourly24h || [], fallback: 'snapshot' };
  if (scope === 'source') return { ok: true, timestamp: snap.timestamp || 0, items: snap.sourceStats || [], fallback: 'snapshot' };
  if (scope === 'model') return { ok: true, timestamp: snap.timestamp || 0, items: snap.models || [], fallback: 'snapshot' };
  if (scope === 'session') return { ok: true, timestamp: snap.timestamp || 0, ...(snap.sessionSummary || {}), fallback: 'snapshot' };
  return null;
}

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

ipcMain.handle('dashboard:getSummary', async (_event, payload = {}) => {
  try { return await localProvider.getSummary(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getSummary', error.message, { payload });
    return snapshotUsageFallback('summary') || { ok: false, error: error.message };
  }
});
ipcMain.handle('dashboard:getTrendBuckets', async (_event, payload = {}) => {
  try { return await localProvider.getTrendBuckets(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getTrendBuckets', error.message, { payload });
    return snapshotUsageFallback('trend') || { ok: false, error: error.message };
  }
});
ipcMain.handle('dashboard:getSourceStats', async (_event, payload = {}) => {
  try { return await localProvider.getSourceStats(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getSourceStats', error.message, { payload });
    return snapshotUsageFallback('source') || { ok: false, error: error.message };
  }
});
ipcMain.handle('dashboard:getModelStats', async (_event, payload = {}) => {
  try { return await localProvider.getModelStats(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getModelStats', error.message, { payload });
    return snapshotUsageFallback('model') || { ok: false, error: error.message };
  }
});
ipcMain.handle('dashboard:getSessionSummary', async (_event, payload = {}) => {
  try { return await localProvider.getSessionSummary(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getSessionSummary', error.message, { payload });
    return snapshotUsageFallback('session') || { ok: false, error: error.message };
  }
});
ipcMain.handle('dashboard:getAggregates', async (_event, payload = {}) => {
  try { return await localProvider.getDashboardAggregates(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getAggregates', error.message, { payload });
    const summary = snapshotUsageFallback('summary');
    const trend = snapshotUsageFallback('trend');
    const source = snapshotUsageFallback('source');
    const model = snapshotUsageFallback('model');
    const session = snapshotUsageFallback('session');
    return {
      ok: Boolean(summary || trend || source || model || session),
      timestamp: Date.now(),
      usage: summary?.usage || {},
      sources: summary?.sources || [],
      buckets: trend?.buckets || [],
      sourceStats: source?.items || [],
      modelStats: model?.items || [],
      sessionSummary: session || {},
      fallback: 'snapshot',
      error: error.message,
    };
  }
});
ipcMain.handle('dashboard:getDatabaseHealth', async (_event, payload = {}) => {
  try { return await localProvider.getDatabaseHealth(dashboardAggregatePayload(payload)); }
  catch (error) {
    appendLog('warn', 'dashboard:getDatabaseHealth', error.message, { payload });
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('dashboard:getDiff', async (_event, payload = {}) => {
  const since = Number(payload.since || 0);
  const snap = lastSnapshot || errorSnapshot(new Error('尚未刷新'));
  if (!snap.ok) return snap;
  try {
    const range = { start: since || 0, end: Date.now() };
    const [requests, sessions] = await Promise.all([
      localProvider.getRequestsPage({ limit: 100, offset: 0, source: payload.source || 'all', range, query: payload.query || '' }),
      localProvider.getSessionsPage({ limit: SESSION_PAGE_SIZE, offset: 0, source: payload.source || 'all', status: payload.status || 'active', project: payload.project || 'all', range, query: payload.sessionQuery || '' }),
    ]);
    return { ok: true, timestamp: Date.now(), changed: Boolean((requests.items || []).length || (sessions.items || []).length), requests: requests.items || [], sessions: sessions.items || [], requestTotal: requests.total || 0, sessionTotal: sessions.total || 0, source: 'db-page' };
  } catch (error) {
    appendLog('warn', 'dashboard:getDiff', error.message, { payload });
    return { ok: true, timestamp: snap.timestamp || 0, changed: !since || Number(snap.timestamp || 0) > since, requests: (snap.requestLog || []).filter((item) => Number(item.time || 0) > since), sessions: (snap.sessions || []).filter((item) => Number(item.updatedAt || 0) > since), fallback: 'snapshot', error: error.message };
  }
});
ipcMain.handle('dashboard:refreshLight', async (_event, payload = {}) => buildDashboardLightSnapshot(payload));
ipcMain.handle('dashboard:refresh', async (_event, payload = {}) => buildDashboardLightSnapshot(payload));
ipcMain.handle('dashboard:refreshFull', async () => { await refreshNow(); return lastSnapshot; });
ipcMain.handle('dashboard:settings', () => openSettingsWindow());
ipcMain.handle('dashboard:setLayoutMode', (_event, mode) => setDashboardLayoutMode(mode));
ipcMain.handle('dashboard:setPinned', (_event, pinned) => setDashboardPinned(pinned));
ipcMain.handle('dashboard:openSession', (_event, session) => openSessionDir(session));
ipcMain.handle('dashboard:openCodeArtsSession', (_event, session) => openCodeArts(session && session.directory));
ipcMain.handle('dashboard:copySession', (_event, session) => clipboard.writeText(`${session.title || ''}\n${session.id || ''}\n${session.directory || ''}`.trim()));
ipcMain.handle('dashboard:log', (_event, entry) => { appendLog(entry?.level || 'info', entry?.scope || 'renderer', entry?.message || '', entry?.detail || null); return { ok: true, path: logPath() }; });
ipcMain.handle('dashboard:getDiagnostics', () => ({ ok: true, version: app.getVersion(), logPath: logPath(), userData: app.getPath('userData'), distPath: path.join(__dirname, '..', 'dist') }));
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

function singleInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.exit(0); return false; }
  app.on('second-instance', () => { refreshLight(); openDashboardWindow(); });
  return true;
}
if (singleInstance()) {
  app.whenReady().then(() => {
    app.setAppUserModelId('CodeArtsBar');
    tray = new Tray(makeTrayIcon(null));
    tray.setToolTip('码道 Bar 正在启动…');
    tray.on('click', () => restoreDashboardWindow());
    tray.on('double-click', () => restoreDashboardWindow());
    tray.on('right-click', () => showTrayMenu());
    refreshTrayMenu();
    refreshLight();
    scheduleRefresh();
    scheduleDbWatch();
  });
  app.on('before-quit', () => {
    isQuitting = true;
    app.isQuitting = true;
    cleanupRuntime();
    if (!forcedExitTimer) {
      forcedExitTimer = setTimeout(() => app.exit(0), 800);
      forcedExitTimer.unref?.();
    }
  });
  app.on('window-all-closed', (event) => {
    if (!isQuitting) event.preventDefault();
  });
  app.on('will-quit', cleanupRuntime);
}
