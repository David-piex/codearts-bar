'use strict';

const { sqliteRuntimeStatus } = require('../providers/codearts/sqlite');
const { paginateSnapshotList, createSnapshotFallback, decorateWithRuntimeDiagnostics, buildDiagnosticsSummary } = require('./ipc-dashboard-support');
const { buildUnifiedDiagnostics } = require('../diagnostics-report');

function registerDashboardIpc({
  ipcMain,
  app,
  path,
  localProvider,
  appendLog,
  logPath,
  getCrashState,
  recordRendererError,
  getLastSnapshot,
  getLastDashboardSnapshot,
  buildInitialSummarySnapshot,
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
}) {
  const snapshotUsageFallback = createSnapshotFallback(getLastSnapshot);
  const withRuntimeDiagnostics = (snap) => decorateWithRuntimeDiagnostics(snap, getCrashState?.());
  const fallbackPage = (list, payload) => paginateSnapshotList(list, payload, {
    pageBounds,
    matchesPageFilters,
    snapshotTimestamp: getLastSnapshot()?.timestamp || 0,
  });

  ipcMain.handle('dashboard:getRuntimeInfo', () => sqliteRuntimeStatus());
  ipcMain.handle('dashboard:getInitialSummary', async (_event, payload = {}) => {
    try {
      const cached = getLastDashboardSnapshot() || getLastSnapshot();
      const reusableRange = ['today', '1d', '7d', 'all'].includes(String(payload.rangeKey || ''));
      if(cached?.ok && cached.usage && reusableRange && String(payload.source || 'all') === 'all' && String(payload.model || 'all') === 'all') {
        return withRuntimeDiagnostics({
          ...cached,
          summaryOnly: true,
          summaryFilter: {
            source: 'all',
            model: 'all',
            rangeKey: payload.rangeKey || '',
            start: Number(payload.start ?? payload.range?.start ?? 0),
            end: Number(payload.end ?? payload.range?.end ?? 0),
          },
          freshness: { ...(cached.freshness || {}), source: 'summary-cache', ageMs: Math.max(0, Date.now() - Number(cached.timestamp || Date.now())) },
        });
      }
      return withRuntimeDiagnostics(await buildInitialSummarySnapshot(payload));
    }
    catch (error) {
      appendLog('warn', 'dashboard:getInitialSummary', error.message, { payload });
      const fallback = getLastDashboardSnapshot() || getLastSnapshot();
      return withRuntimeDiagnostics(fallback || { ok: false, error: error.message });
    }
  });

  ipcMain.handle('dashboard:getSnapshot', async (_event, payload = {}) => {
    const lastSnapshot = getLastSnapshot();
    const lastDashboardSnapshot = getLastDashboardSnapshot();
    if (!lastSnapshot || !lastSnapshot.ok) return withRuntimeDiagnostics(lastDashboardSnapshot || lastSnapshot || await buildInitialLightSnapshot(payload));
    if (payload && Object.keys(payload).length) return withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload));
    return withRuntimeDiagnostics(lastDashboardSnapshot || buildDashboardPreviewSnapshot(lastSnapshot));
  });
  ipcMain.handle('dashboard:getRequestsPage', async (_event, payload = {}) => {
    try { return await localProvider.getRequestsPage(payload); }
    catch (error) {
      appendLog('warn', 'dashboard:getRequestsPage', error.message, { payload });
      const page = fallbackPage((getLastSnapshot() && getLastSnapshot().requestLog) || [], payload);
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
      const filtered = ((getLastSnapshot() && getLastSnapshot().requestLog) || []).filter((item) => {
        if (sessionId && item.sessionId !== sessionId) return false;
        if (source && source !== 'all' && String(item.source || '').toLowerCase() !== source) return false;
        return true;
      });
      const page = fallbackPage(filtered, payload);
      page.fallback = 'snapshot';
      page.error = error.message;
      return page;
    }
  });
  ipcMain.handle('dashboard:getSessionsPage', async (_event, payload = {}) => {
    try { return await localProvider.getSessionsPage(payload); }
    catch (error) {
      appendLog('warn', 'dashboard:getSessionsPage', error.message, { payload });
      const page = fallbackPage((getLastSnapshot() && getLastSnapshot().sessions) || [], payload);
      page.fallback = 'snapshot';
      page.error = error.message;
      return page;
    }
  });
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
    const snap = getLastSnapshot() || errorSnapshot(new Error('尚未刷新'));
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
  ipcMain.handle('dashboard:refreshLight', async (_event, payload = {}) => withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload)));
  ipcMain.handle('dashboard:refresh', async (_event, payload = {}) => withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload)));
  ipcMain.handle('dashboard:refreshFull', async () => { await refreshNow(); return withRuntimeDiagnostics(getLastSnapshot()); });
  ipcMain.handle('dashboard:settings', () => openSettingsWindow());
  ipcMain.handle('dashboard:setLayoutMode', (_event, mode) => setDashboardLayoutMode(mode));
  ipcMain.handle('dashboard:setPinned', (_event, pinned) => setDashboardPinned(pinned));
  ipcMain.handle('dashboard:log', (_event, entry) => { appendLog(entry?.level || 'info', entry?.scope || 'renderer', entry?.message || '', entry?.detail || null); return { ok: true, path: logPath() }; });
  ipcMain.handle('dashboard:rendererError', (_event, entry = {}) => {
    const payload = entry && typeof entry === 'object' ? entry : { message: String(entry || '') };
    recordRendererError?.(payload.type || 'renderer_error', payload.error || payload.message || payload, payload.detail || null);
    return { ok: true, path: logPath() };
  });
  ipcMain.handle('dashboard:getDiagnostics', async () => {
    let database = null;
    try { database = await localProvider.getDatabaseHealth(dashboardAggregatePayload({ timestamp: Date.now() })); }
    catch (error) {
      appendLog('warn', 'dashboard:getDiagnostics:database', error.message);
      try { database = { ok: false, error: error.message, diagnostics: localProvider.getDatabaseDiagnostics({ timestamp: Date.now() }) }; }
      catch { database = { ok: false, error: error.message }; }
    }
    let performance = null;
    try {
      performance = {
        aggregateCache: typeof localProvider.aggregateCacheStats === 'function' ? localProvider.aggregateCacheStats() : null,
        usageRollup: typeof localProvider.usageRollupStats === 'function' ? localProvider.usageRollupStats() : null,
        slowAggregates: typeof localProvider.slowAggregateStats === 'function' ? localProvider.slowAggregateStats() : null,
      };
    } catch (error) {
      performance = { error: error.message };
    }
    const payload = { ok: true, version: app.getVersion(), logPath: logPath(), userData: app.getPath('userData'), distPath: path.join(__dirname, '..', 'dist'), database, runtime: getCrashState?.() || null, performance };
    payload.summary = buildDiagnosticsSummary(payload, path);
    payload.unified = buildUnifiedDiagnostics({ snapshot: getLastSnapshot(), database, runtime: payload.runtime, performance, paths: { log: payload.logPath, userData: payload.userData, dist: payload.distPath }, fs: require('node:fs'), path, version: payload.version });
    return payload;
  });
}

module.exports = { registerDashboardIpc, paginateSnapshotList, decorateWithRuntimeDiagnostics, buildDiagnosticsSummary };
