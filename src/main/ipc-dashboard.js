'use strict';

const crypto = require('node:crypto');
const { sqliteRuntimeStatus } = require('../providers/codearts/sqlite');
const fs = require('node:fs');
const pathModule = require('node:path');

function paginateSnapshotList(list, payload = {}, { pageBounds, matchesPageFilters, snapshotTimestamp = 0 }) {
  const { limit, offset } = pageBounds(payload);
  const filtered = (list || []).filter((item) => matchesPageFilters(item, payload));
  return {
    ok: true,
    limit,
    offset,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    items: filtered.slice(offset, offset + limit),
    snapshotTimestamp,
  };
}

function createSnapshotFallback(getLastSnapshot) {
  return function snapshotUsageFallback(scope) {
    const snap = getLastSnapshot() || null;
    if (!snap || !snap.ok) return null;
    if (scope === 'summary') return { ok: true, timestamp: snap.timestamp || 0, usage: snap.usage || {}, sources: snap.sources || [], fallback: 'snapshot' };
    if (scope === 'trend') return { ok: true, timestamp: snap.timestamp || 0, buckets: snap.trends?.hourly24h || [], fallback: 'snapshot' };
    if (scope === 'source') return { ok: true, timestamp: snap.timestamp || 0, items: snap.sourceStats || [], fallback: 'snapshot' };
    if (scope === 'model') return { ok: true, timestamp: snap.timestamp || 0, items: snap.models || [], fallback: 'snapshot' };
    if (scope === 'session') return { ok: true, timestamp: snap.timestamp || 0, ...(snap.sessionSummary || {}), fallback: 'snapshot' };
    return null;
  };
}

function runtimeDiagnosticIssues(runtime = null) {
  return Array.isArray(runtime?.issues) ? runtime.issues : [];
}

function decorateWithRuntimeDiagnostics(snapshot, runtime = null) {
  const issues = runtimeDiagnosticIssues(runtime);
  if (!snapshot || typeof snapshot !== 'object' || !issues.length) return snapshot;
  const existing = Array.isArray(snapshot.diagnostics?.issues) ? snapshot.diagnostics.issues : [];
  const seen = new Set(existing.map((item) => `${item.code || item.title}:${item.detail || ''}`));
  const merged = [...existing];
  for (const issue of issues) {
    const key = `${issue.code || issue.title}:${issue.detail || ''}`;
    if (!seen.has(key)) merged.unshift(issue);
  }
  return {
    ...snapshot,
    diagnostics: {
      ...(snapshot.diagnostics || {}),
      issues: merged,
    },
    runtimeDiagnostics: runtime,
  };
}

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function sanitizeText(value = '') {
  return String(value || '')
    .replace(/[A-Za-z]:[\\/][^\s'",;]+/g, '[path]')
    .replace(/\/(?:[^/\s'",;]+\/)+[^/\s'",;]+/g, '[path]')
    .replace(/\\\\(?:[^\\\s'",;]+\\)+[^\\\s'",;]+/g, '[path]')
    .slice(0, 300);
}

function safePathSummary(filePath = '', pathLike = pathModule) {
  const value = String(filePath || '');
  if (!value) return { name: '', hash: '', exists: false };
  let exists = false;
  try { exists = fs.existsSync(value); } catch {}
  return {
    name: pathLike.basename(value),
    hash: hashText(value),
    exists,
  };
}

function sanitizeMetricGroups(groups = {}) {
  const out = {};
  for (const [key, value] of Object.entries(groups || {})) {
    out[sanitizeText(key)] = {
      count: Number(value?.count || 0),
      failed: Number(value?.failed || 0),
      maxMs: Number(value?.maxMs || 0),
      lastMs: Number(value?.lastMs || 0),
    };
  }
  return out;
}

function issueBucket(issues = []) {
  const grouped = { bad: [], warn: [], info: [] };
  for (const issue of Array.isArray(issues) ? issues : []) {
    const tone = issue?.tone === 'bad' || issue?.tone === 'danger' || issue?.tone === 'error'
      ? 'bad'
      : issue?.tone === 'warn' || issue?.tone === 'warning'
        ? 'warn'
        : 'info';
    grouped[tone].push({
      code: String(issue?.code || ''),
      source: String(issue?.source || ''),
      title: sanitizeText(issue?.title || issue?.code || ''),
      detail: sanitizeText(issue?.detail || issue?.message || issue?.error || ''),
    });
  }
  return grouped;
}

function sourceSummary(source = {}, pathLike = pathModule) {
  const dbPath = String(source.dbPath || source.path || '');
  const messageCount = Number(source.messageCount || source.messages || 0);
  const sessionCount = Number(source.sessionCount || source.sessions || 0);
  return {
    id: String(source.id || source.source || ''),
    label: String(source.label || source.id || source.source || ''),
    exists: Boolean(source.exists),
    readable: Boolean(source.readable),
    size: Number(source.size || 0),
    messageCount,
    sessionCount,
    empty: Boolean(source.exists && source.readable && messageCount === 0 && sessionCount === 0),
    dbName: dbPath ? pathLike.basename(dbPath) : '',
    dbHash: dbPath ? hashText(dbPath) : '',
  };
}

function sourceStatusSummary(sources = []) {
  const byId = {};
  for (const source of sources) {
    byId[source.id || source.label || 'unknown'] = {
      label: source.label,
      exists: Boolean(source.exists),
      readable: Boolean(source.readable),
      empty: Boolean(source.empty),
      messageCount: Number(source.messageCount || 0),
      sessionCount: Number(source.sessionCount || 0),
      dbName: source.dbName || '',
      dbHash: source.dbHash || '',
    };
  }
  return byId;
}

function diagnosticNextActions({ status, missingSources, emptyReadableSources, fallbackActive, badCount, warnCount, runtimeIssues, sidecar = {}, slowAggregates = {} }) {
  const actions = [];
  if (missingSources.length) {
    actions.push({
      code: 'check_data_source',
      title: '检查 CodeArts 数据源',
      detail: '没有找到可读取的 opencode.db。请先运行 CodeArts Agent 桌面端或 CLI，或在设置中确认数据库路径。',
    });
  }
  if (emptyReadableSources.length) {
    actions.push({
      code: 'produce_first_session',
      title: '先产生一条会话数据',
      detail: '数据库可以读取，但 message/session 表暂时为空。请在 CodeArts Agent 或 CLI 中完成一次会话后刷新。',
    });
  }
  if (fallbackActive) {
    actions.push({
      code: 'sqlite_fallback_active',
      title: '当前使用 sql.js 兼容模式',
      detail: 'node:sqlite 当前不可用，已自动回退到 sql.js。功能可用，但首次聚合可能更慢。',
    });
  }
  if (Number(slowAggregates.count || 0) > 0 || Number(slowAggregates.maxMs || 0) >= 300) {
    actions.push({
      code: 'review_slow_aggregates',
      title: '检查聚合缓存与 sidecar',
      detail: '检测到 300ms 以上的冷聚合。请等待 rollup/sidecar 缓存完成，再观察热路径耗时。',
    });
  }
  if (Number(sidecar.pendingCount || 0) > 0) {
    actions.push({
      code: 'wait_sidecar_build',
      title: '等待 sidecar 缓存建立',
      detail: 'usage rollup 正在后台构建。大数据量首次生成可能稍慢，完成后刷新会明显加快。',
    });
  }
  if (Number(sidecar.buildFailed || 0) > 0 || Number(sidecar.invalid || 0) > 0) {
    actions.push({
      code: 'check_sidecar_cache',
      title: '检查 sidecar 缓存',
      detail: '检测到 rollup 构建失败或缓存失效。可刷新重试，并复制诊断报告排查。',
    });
  }
  if (runtimeIssues) {
    actions.push({
      code: 'review_crash_logs',
      title: '检查运行日志',
      detail: '检测到上次异常退出或渲染错误。请查看本地日志，并复制脱敏诊断报告。',
    });
  }
  if (!actions.length && (badCount || warnCount)) {
    actions.push({
      code: 'copy_diagnostics',
      title: '复制诊断报告',
      detail: '复制脱敏诊断报告后，可将内容附到 issue 中协助定位。',
    });
  }
  if (!actions.length && status === 'ok') {
    actions.push({
      code: 'all_good',
      title: '运行状态正常',
      detail: '数据源、SQLite 运行时和缓存状态均未发现需要处理的问题。',
    });
  }
  return actions.slice(0, 5);
}

function buildDiagnosticsSummary(payload = {}, pathLike = pathModule) {
  const database = payload.database || {};
  const diagnostics = database?.diagnostics || {};
  const sqliteRuntime = diagnostics?.runtime || {};
  const native = sqliteRuntime?.native || {};
  const adapter = sqliteRuntime?.preferred || native?.adapter || (database?.nativeError ? 'sql.js' : 'unknown');
  const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues : [];
  const groupedIssues = issueBucket([
    ...issues,
    ...((Array.isArray(payload.runtime?.issues) ? payload.runtime.issues : [])),
  ]);
  const sources = Array.isArray(diagnostics?.sources)
    ? diagnostics.sources.map((source) => sourceSummary(source, pathLike))
    : Array.isArray(database?.items)
      ? database.items.map((source) => sourceSummary(source, pathLike))
      : [];
  const missingSources = sources.filter((source) => !source.exists);
  const emptySources = sources.filter((source) => source.exists && Number(source.size || 0) === 0);
  const emptyReadableSources = sources.filter((source) => source.exists && source.readable && source.empty);
  const readableSources = sources.filter((source) => source.exists && source.readable);
  const usageRollup = payload.performance?.usageRollup || {};
  const aggregateCache = payload.performance?.aggregateCache || {};
  const slowAggregates = payload.performance?.slowAggregates || {};
  const wasmPath = sqliteRuntime?.fallback?.wasm || '';
  const fallbackActive = adapter === 'sql.js' || Boolean(database?.nativeError) || issues.some((issue) => issue?.code === 'sqlite_fallback' || issue?.code === 'node_sqlite_unavailable');
  const badCount = groupedIssues.bad.length;
  const warnCount = groupedIssues.warn.length;
  const status = badCount ? 'bad' : warnCount ? 'warn' : 'ok';
  const runtimeIssues = Boolean(Array.isArray(payload.runtime?.issues) && payload.runtime.issues.length);
  return {
    status,
    adapter,
    fallbackActive,
    sourceCount: sources.length,
    readableSources: readableSources.length,
    sourceStatus: sourceStatusSummary(sources),
    missingSources,
    emptySources,
    emptyReadableSources,
    issues: groupedIssues,
    nextActions: diagnosticNextActions({ status, missingSources, emptyReadableSources, fallbackActive, badCount, warnCount, runtimeIssues, sidecar: usageRollup, slowAggregates }),
    sidecar: {
      enabled: usageRollup.enabled !== false,
      buildEnabled: usageRollup.buildEnabled !== false,
      pendingCount: Number(usageRollup.pendingCount || 0),
      hitRate: usageRollup.hitRate ?? null,
      reads: Number(usageRollup.reads || 0),
      misses: Number(usageRollup.misses || 0),
      invalid: Number(usageRollup.invalid || 0),
      lastBuildMs: usageRollup.lastBuildMs ?? null,
      lastBuildStatus: usageRollup.lastBuild?.status || null,
      buildFailed: Number(usageRollup.buildFailed || 0),
      buildCompleted: Number(usageRollup.buildCompleted || 0),
    },
    aggregateCache: {
      hits: Number(aggregateCache.hits || 0),
      misses: Number(aggregateCache.misses || 0),
      reads: Number(aggregateCache.reads || 0),
      hitRate: aggregateCache.hitRate ?? null,
      size: Number(aggregateCache.size || 0),
      limit: Number(aggregateCache.limit || 0),
    },
    slowAggregates: {
      count: Number(slowAggregates.count || 0),
      failed: Number(slowAggregates.failed || 0),
      maxMs: Number(slowAggregates.maxMs || 0),
      last: slowAggregates.last ? {
        label: String(slowAggregates.last.label || ''),
        adapter: String(slowAggregates.last.adapter || ''),
        ms: Number(slowAggregates.last.ms || 0),
        failed: Boolean(slowAggregates.last.failed),
        scope: sanitizeText(slowAggregates.last.scope || ''),
        timestamp: Number(slowAggregates.last.timestamp || 0),
      } : null,
      byLabel: sanitizeMetricGroups(slowAggregates.byLabel),
      byAdapter: sanitizeMetricGroups(slowAggregates.byAdapter),
    },
    resources: {
      sqlWasm: {
        name: wasmPath ? pathLike.basename(wasmPath) : 'sql-wasm.wasm',
        hash: wasmPath ? hashText(wasmPath) : '',
        exists: wasmPath ? safePathSummary(wasmPath, pathLike).exists : false,
      },
    },
    logs: {
      logPathSafeName: payload.logPath ? pathLike.basename(payload.logPath) : '',
      logPathHash: payload.logPath ? hashText(payload.logPath) : '',
      hasLogPath: Boolean(payload.logPath),
      userDataHash: payload.userData ? hashText(payload.userData) : '',
      distHash: payload.distPath ? hashText(payload.distPath) : '',
    },
    crash: {
      cleanExit: payload.runtime?.marker?.cleanExit ?? null,
      issueCount: Array.isArray(payload.runtime?.issues) ? payload.runtime.issues.length : 0,
      hasRuntimeIssues: runtimeIssues,
    },
  };
}

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
    return payload;
  });
}

module.exports = { registerDashboardIpc, paginateSnapshotList, decorateWithRuntimeDiagnostics, buildDiagnosticsSummary };
