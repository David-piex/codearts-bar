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
  getDashboardSnapshotForPayload,
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
  const snapshotUsageFallback = (scope, payload = {}) => createSnapshotFallback(
    () => getDashboardSnapshotForPayload?.(payload) || null
  )(scope);
  const withRuntimeDiagnostics = (snap) => decorateWithRuntimeDiagnostics(snap, getCrashState?.());
  const fallbackPage = (list, payload, snapshotTimestamp = 0) => paginateSnapshotList(list, payload, {
    pageBounds,
    matchesPageFilters,
    snapshotTimestamp,
  });
  const failedPage = (payload, error) => {
    const { limit, offset } = pageBounds(payload);
    return { ok: false, limit, offset, total: 0, hasMore: false, items: [], snapshotTimestamp: 0, error: '读取数据页失败' };
  };

  ipcMain.handle('dashboard:getRuntimeInfo', () => sqliteRuntimeStatus());
  ipcMain.handle('dashboard:getInitialSummary', async (_event, payload = {}) => {
    try {
      const cached = getDashboardSnapshotForPayload?.(payload) || null;
      if(cached?.ok && cached.usage) return withRuntimeDiagnostics(cached);
      return withRuntimeDiagnostics(await buildInitialSummarySnapshot(payload));
    }
    catch (error) {
      appendLog('warn', 'dashboard:getInitialSummary', error.message, { payload });
      const fallback = getDashboardSnapshotForPayload?.(payload) || null;
      return withRuntimeDiagnostics(fallback || { ok: false, error: '读取摘要失败' });
    }
  });

  ipcMain.handle('dashboard:getSnapshot', async (_event, payload = {}) => {
    const lastSnapshot = getLastSnapshot();
    const lastDashboardSnapshot = getLastDashboardSnapshot();
    if (!lastSnapshot || !lastSnapshot.ok) return withRuntimeDiagnostics(await buildInitialLightSnapshot(payload));
    if (payload && Object.keys(payload).length) return withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload));
    return withRuntimeDiagnostics(lastDashboardSnapshot || buildDashboardPreviewSnapshot(lastSnapshot));
  });
  ipcMain.handle('dashboard:getRequestsPage', async (_event, payload = {}) => {
    try { return await localProvider.getRequestsPage(payload); }
    catch (error) {
      appendLog('warn', 'dashboard:getRequestsPage', error.message, { payload });
      const fallback = getDashboardSnapshotForPayload?.(payload) || null;
      if (!fallback) return failedPage(payload, error);
      const page = fallbackPage(fallback?.requestLog || [], payload, fallback?.timestamp || 0);
      page.fallback = 'snapshot';
      page.error = '读取请求页失败';
      return page;
    }
  });
  ipcMain.handle('dashboard:getSessionRequestsPage', async (_event, payload = {}) => {
    try { return await localProvider.getSessionRequestsPage(payload); }
    catch (error) {
      appendLog('warn', 'dashboard:getSessionRequestsPage', error.message, { payload });
      const sessionId = String(payload.sessionId || '').trim();
      const source = String(payload.source || 'all').toLowerCase();
      const fallback = getDashboardSnapshotForPayload?.(payload) || null;
      if (!fallback) return failedPage(payload, error);
      const filtered = (fallback?.requestLog || []).filter((item) => {
        if (sessionId && item.sessionId !== sessionId) return false;
        if (source && source !== 'all' && String(item.source || '').toLowerCase() !== source) return false;
        return true;
      });
      const page = fallbackPage(filtered, payload, fallback?.timestamp || 0);
      page.fallback = 'snapshot';
      page.error = '读取会话请求页失败';
      return page;
    }
  });
  ipcMain.handle('dashboard:getSessionsPage', async (_event, payload = {}) => {
    try { return await localProvider.getSessionsPage(payload); }
    catch (error) {
      appendLog('warn', 'dashboard:getSessionsPage', error.message, { payload });
      const fallback = getDashboardSnapshotForPayload?.(payload) || null;
      if (!fallback) return failedPage(payload, error);
      const page = fallbackPage(fallback?.sessions || [], payload, fallback?.timestamp || 0);
      page.fallback = 'snapshot';
      page.error = '读取会话页失败';
      return page;
    }
  });
  ipcMain.handle('dashboard:getSummary', async (_event, payload = {}) => {
    try { return await localProvider.getSummary(dashboardAggregatePayload(payload)); }
    catch (error) {
      appendLog('warn', 'dashboard:getSummary', error.message, { payload });
      return snapshotUsageFallback('summary', payload) || { ok: false, error: '读取摘要失败' };
    }
  });
  ipcMain.handle('dashboard:getTrendBuckets', async (_event, payload = {}) => {
    try { return await localProvider.getTrendBuckets(dashboardAggregatePayload(payload)); }
    catch (error) {
      appendLog('warn', 'dashboard:getTrendBuckets', error.message, { payload });
      return snapshotUsageFallback('trend', payload) || { ok: false, error: '读取趋势失败' };
    }
  });
  ipcMain.handle('dashboard:getSourceStats', async (_event, payload = {}) => {
    try { return await localProvider.getSourceStats(dashboardAggregatePayload(payload)); }
    catch (error) {
      appendLog('warn', 'dashboard:getSourceStats', error.message, { payload });
      return snapshotUsageFallback('source', payload) || { ok: false, error: '读取来源统计失败' };
    }
  });
  ipcMain.handle('dashboard:getModelStats', async (_event, payload = {}) => {
    try { return await localProvider.getModelStats(dashboardAggregatePayload(payload)); }
    catch (error) {
      appendLog('warn', 'dashboard:getModelStats', error.message, { payload });
      return snapshotUsageFallback('model', payload) || { ok: false, error: '读取模型统计失败' };
    }
  });
  ipcMain.handle('dashboard:getSessionSummary', async (_event, payload = {}) => {
    try { return await localProvider.getSessionSummary(dashboardAggregatePayload({ ...payload, query: payload.sessionQuery || '' })); }
    catch (error) {
      appendLog('warn', 'dashboard:getSessionSummary', error.message, { payload });
      return snapshotUsageFallback('session', payload) || { ok: false, error: '读取会话统计失败' };
    }
  });
  ipcMain.handle('dashboard:getAggregates', async (_event, payload = {}) => {
    try { return await localProvider.getDashboardAggregates(dashboardAggregatePayload(payload)); }
    catch (error) {
      appendLog('warn', 'dashboard:getAggregates', error.message, { payload });
      const summary = snapshotUsageFallback('summary', payload);
      const trend = snapshotUsageFallback('trend', payload);
      const source = snapshotUsageFallback('source', payload);
      const model = snapshotUsageFallback('model', payload);
      const session = snapshotUsageFallback('session', payload);
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
        error: '读取聚合数据失败',
      };
    }
  });
  ipcMain.handle('dashboard:getDatabaseHealth', async (_event, payload = {}) => {
    try { return await localProvider.getDatabaseHealth(dashboardAggregatePayload(payload)); }
    catch (error) {
      appendLog('warn', 'dashboard:getDatabaseHealth', error.message, { payload });
      return { ok: false, error: '读取数据库健康状态失败' };
    }
  });
  ipcMain.handle('dashboard:getDiff', async (_event, payload = {}) => {
    const since = Number(payload.since || 0);
    const snap = getLastSnapshot() || errorSnapshot(new Error('尚未刷新'));
    if (!snap.ok) return snap;
    try {
      const range = { start: since || 0, end: Date.now() };
      const [requests, sessions] = await Promise.all([
        localProvider.getRequestsPage({ limit: 100, offset: 0, source: payload.source || 'all', model: payload.model || 'all', project: payload.project || 'all', range, query: payload.query || '' }),
        localProvider.getSessionsPage({ limit: SESSION_PAGE_SIZE, offset: 0, source: payload.source || 'all', status: payload.status || 'active', project: payload.project || 'all', range, query: payload.sessionQuery || '' }),
      ]);
      return { ok: true, timestamp: Date.now(), changed: Boolean((requests.items || []).length || (sessions.items || []).length), requests: requests.items || [], sessions: sessions.items || [], requestTotal: requests.total || 0, sessionTotal: sessions.total || 0, source: 'db-page' };
    } catch (error) {
      appendLog('warn', 'dashboard:getDiff', error.message, { payload });
      return { ok: true, timestamp: snap.timestamp || 0, changed: !since || Number(snap.timestamp || 0) > since, requests: (snap.requestLog || []).filter((item) => Number(item.time || 0) > since), sessions: (snap.sessions || []).filter((item) => Number(item.updatedAt || 0) > since), fallback: 'snapshot', error: '实时差异读取失败，已使用快照' };
    }
  });
  ipcMain.handle('dashboard:refreshLight', async (_event, payload = {}) => withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload)));
  ipcMain.handle('dashboard:refresh', async (_event, payload = {}) => withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload)));
  ipcMain.handle('dashboard:refreshFull', async (_event, payload = {}) => {
    await refreshNow();
    if (payload && Object.keys(payload).length) return withRuntimeDiagnostics(await buildDashboardLightSnapshot(payload));
    return withRuntimeDiagnostics(getLastSnapshot());
  });
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
      try { database = { ok: false, error: '数据库健康检查失败', diagnostics: localProvider.getDatabaseDiagnostics({ timestamp: Date.now() }) }; }
      catch { database = { ok: false, error: '数据库健康检查失败' }; }
    }
    let performance = null;
    try {
      performance = {
        aggregateCache: typeof localProvider.aggregateCacheStats === 'function' ? localProvider.aggregateCacheStats() : null,
        usageRollup: typeof localProvider.usageRollupStats === 'function' ? localProvider.usageRollupStats() : null,
        slowAggregates: typeof localProvider.slowAggregateStats === 'function' ? localProvider.slowAggregateStats() : null,
      };
    } catch (error) {
      performance = { error: '读取性能诊断失败' };
    }
    const raw = {
      version: app.getVersion(),
      logPath: logPath(),
      userData: app.getPath('userData'),
      distPath: path.join(__dirname, '..', 'dist'),
      database,
      runtime: getCrashState?.() || null,
      performance,
    };
    const summary = buildDiagnosticsSummary(raw, path);
    const unified = buildUnifiedDiagnostics({
      snapshot: getLastSnapshot(),
      database,
      runtime: raw.runtime,
      performance,
      paths: { log: raw.logPath, userData: raw.userData, dist: raw.distPath },
      fs: require('node:fs'),
      path,
      version: raw.version,
    });
    return {
      ok: true,
      version: raw.version,
      summary,
      unified,
      performance: {
        aggregateCache: summary.aggregateCache,
        usageRollup: {
          ...summary.sidecar,
          lastBuild: summary.sidecar.lastBuildStatus ? { status: summary.sidecar.lastBuildStatus } : null,
        },
        slowAggregates: summary.slowAggregates,
      },
    };
  });
}

module.exports = { registerDashboardIpc, paginateSnapshotList, decorateWithRuntimeDiagnostics, buildDiagnosticsSummary };
