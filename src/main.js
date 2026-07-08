'use strict';

const { app, Menu, Tray, nativeImage, shell, clipboard, Notification, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { getSnapshotWithCache, snapshotToText, errorSnapshot, fmtInt } = require('./codeartsData');
const { loadSettings, saveSettings } = require('./settings');
const { diagnose } = require('./diagnose');
const { buildHealth, notificationEvents } = require('./health');
const localProvider = require('./providers/codeartsLocal');

let tray = null;
let lastSnapshot = null;
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
      { label: '刷新', click: refreshNow },
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
  template.push({ label: '刷新', click: refreshNow });
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
  const previousLevel = lastSnapshot && lastSnapshot.ok ? lastSnapshot.status.level : null;
  const previousHealth = lastSnapshot && lastSnapshot.ok ? lastSnapshot.health : null;
  try { lastSnapshot = await getSnapshotWithCache(loadSettings()); }
  catch (error) { appendLog('error', 'refresh', error.message, { stack: error.stack }); lastSnapshot = errorSnapshot(error); }
  if (tray) {
    tray.setImage(makeTrayIcon(lastSnapshot));
    tray.setToolTip(lastSnapshot.ok ? snapshotToText(lastSnapshot) : `码道 Bar\n${lastSnapshot.error}`);
    tray.setContextMenu(buildMenu(lastSnapshot));
  }
  if (lastSnapshot.ok && loadSettings().notifyDanger && previousLevel !== 'danger' && lastSnapshot.status.level === 'danger' && Notification.isSupported()) {
    new Notification({ title: '码道 Bar', body: `今日 token 使用偏高：${lastSnapshot.status.label}` }).show();
  }
  const settings = loadSettings();
  if (lastSnapshot.ok && settings.notifyHealth && Notification.isSupported()) {
    for (const issue of notificationEvents(previousHealth, lastSnapshot.health).slice(0, 2)) {
      new Notification({ title: `码道 Bar · ${issue.level}`, body: issue.message }).show();
    }
  }
  pushDashboard();
  refreshOfficialInBackground();
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
  refreshTimer = setInterval(refreshNow, loadSettings().refreshMs);
}
function triggerRefreshSoon(reason = 'watch') {
  if (dbRefreshDebounce) clearTimeout(dbRefreshDebounce);
  dbRefreshDebounce = setTimeout(refreshNow, reason === 'poll' ? 250 : 500);
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
    if (compact) {
      dashboardWindow.setMinimumSize(500, 620);
      dashboardWindow.setSize(560, 760, true);
    } else {
      dashboardWindow.setMinimumSize(980, 680);
      dashboardWindow.setSize(1280, 860, true);
    }
    dashboardWindow.center();
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
  if (dashboardWindow && !dashboardWindow.isDestroyed() && lastSnapshot) dashboardWindow.webContents.send('dashboard:snapshot', lastSnapshot);
}
async function refreshOfficialInBackground() {
  return;
}
function pageBounds(payload = {}) {
  const limit = Math.max(1, Math.min(500, Number(payload.limit || 100)));
  const offset = Math.max(0, Number(payload.offset || 0));
  return { limit, offset };
}
function normalizePageRange(range = {}) {
  const start = Number(range.start || 0);
  const end = Number(range.end || 0);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    end: Number.isFinite(end) && end > 0 ? end : 0,
  };
}
function matchesPageFilters(item, payload = {}) {
  if (!item) return false;
  if (payload.source && payload.source !== 'all' && String(item.source || '') !== String(payload.source)) return false;
  const { start, end } = normalizePageRange(payload.range);
  const time = Number(item.time || item.updatedAt || item.createdAt || 0);
  if (start && time && time < start) return false;
  if (end && time && time > end) return false;
  const query = String(payload.query || '').trim().toLowerCase();
  if (query) {
    const text = [
      item.id,
      item.sessionId,
      item.sessionTitle,
      item.title,
      item.directory,
      item.provider,
      item.model,
      item.sourceLabel,
      item.source,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
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
ipcMain.handle('settings:set', async (_event, next) => { const saved = saveSettings(next); scheduleRefresh(); scheduleDbWatch(); await refreshNow(); return saved; });
ipcMain.handle('diagnose:get', async () => diagnose());
ipcMain.handle('auth:get', async () => ({}));
ipcMain.handle('dashboard:getSnapshot', () => lastSnapshot || errorSnapshot(new Error('尚未刷新')));
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
ipcMain.handle('dashboard:getDiff', (_event, payload = {}) => {
  const since = Number(payload.since || 0);
  const snap = lastSnapshot || errorSnapshot(new Error('尚未刷新'));
  if (!snap.ok) return snap;
  return {
    ok: true,
    timestamp: snap.timestamp || 0,
    changed: !since || Number(snap.timestamp || 0) > since,
    requests: (snap.requestLog || []).filter((item) => Number(item.time || 0) > since),
    sessions: (snap.sessions || []).filter((item) => Number(item.updatedAt || 0) > since),
  };
});
ipcMain.handle('dashboard:refresh', async () => { await refreshNow(); return lastSnapshot; });
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
  const result = await localProvider.archiveSession({ dbPath: session.dbPath, id: session.id, archived: archived !== false });
  await refreshNow();
  return result;
});
ipcMain.handle('dashboard:renameSession', async (_event, session, title) => {
  const result = await localProvider.renameSession({ dbPath: session.dbPath, id: session.id, title });
  await refreshNow();
  return result;
});

function singleInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.exit(0); return false; }
  app.on('second-instance', () => { refreshNow(); openDashboardWindow(); });
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
    refreshNow();
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

