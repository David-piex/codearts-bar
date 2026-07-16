function syncFooter(){
  const btn = document.getElementById('layoutMode');
  if(btn) btn.textContent = layoutMode === 'compact' ? TXT.dashboardMode : TXT.menuCardMode;
  document.body?.classList?.toggle?.('compact-layout', layoutMode === 'compact');
}
function switchLayoutMode(nextMode, renderOptions = {}){
  const next = nextMode === 'compact' ? 'compact' : 'dashboard';
  if(layoutMode === next){
    syncFooter();
    applyCompactWindowChrome();
    return;
  }
  layoutMode = next;
  localStorage.setItem('layoutMode', layoutMode);
  try {
    document.getElementById('app')?.classList?.add?.('view-switching');
    setAppInteractionMode('view-switching', 200);
  } catch {}
  const opts = { instantChart: true, ...renderOptions };
  if(next === 'dashboard' && renderOptions.deferHeavy === true) opts.deferHeavy = true;
  if(snapshot?.ok) render(snapshot, opts);
  else syncFooter();
}
function applyWindowLayout(){
  const target = layoutMode === 'compact' ? 'compact' : 'dashboard';
  if(lastWindowLayoutApplied === target) return;
  lastWindowLayoutApplied = target;
  ipcRenderer.invoke('dashboard:setLayoutMode', target).catch(() => {});
}
function applyCompactWindowChrome(){
  document.body?.classList?.toggle?.('compact-pinned', compactPinned);
  if(layoutMode === 'compact'){
    ipcRenderer.invoke('dashboard:setPinned', compactPinned).catch(() => {});
  } else {
    ipcRenderer.invoke('dashboard:setPinned', false).catch(() => {});
  }
}
function viewModeKey(){ return layoutMode === 'compact' ? `compact:${compactPane}` : workspaceMode; }

function dashboardBoundaryTimestamp(){
  return Number(dashboardScopeTimestamp || rendererNow());
}
function dashboardPayloadScopeKey(payload = {}){
  const range = payload.range || {};
  const endExclusive = Number(payload.endExclusive ?? payload.end ?? range.endExclusive ?? range.end ?? 0) || 0;
  return JSON.stringify({
    source: String(payload.source || 'all'),
    model: String(payload.model || 'all'),
    project: String(payload.project || 'all'),
    rangeKey: String(payload.rangeKey || ''),
    start: Number(payload.start ?? range.start ?? 0) || 0,
    endExclusive,
  });
}
function beginDashboardRequestGeneration(opts = {}){
  dashboardRequestGeneration += 1;
  if(opts.preserveBoundary !== true) dashboardScopeTimestamp = rendererNow();
  aggregateRefreshToken += 1;
  if(aggregateRefreshTimer){ clearTimeout(aggregateRefreshTimer); aggregateRefreshTimer = null; }
  requestPageLoadToken += 1;
  sessionPageLoadToken += 1;
  requestPageLoading = false;
  sessionPageLoading = false;
  return dashboardRequestGeneration;
}
function captureDashboardRequest(payload = dashboardPayloadForCurrentView()){
  return { generation: dashboardRequestGeneration, scopeKey: dashboardPayloadScopeKey(payload) };
}
function dashboardRequestIsCurrent(ticket, payload = dashboardPayloadForCurrentView()){
  return Boolean(ticket)
    && Number(ticket.generation) === Number(dashboardRequestGeneration)
    && String(ticket.scopeKey || '') === dashboardPayloadScopeKey(payload);
}

function mergeByKey(prev = [], next = [], keyFor){
  const map = new Map();
  for(const item of Array.isArray(prev) ? prev : []){
    try { map.set(keyFor(item), item); } catch {}
  }
  for(const item of Array.isArray(next) ? next : []){
    try { map.set(keyFor(item), item); } catch {}
  }
  return [...map.values()];
}
function mergeLightSnapshotPayload(current, incoming){
  if(!incoming?.ok || !incoming.lightRefresh || !current?.ok) return incoming;
  if(Number(current.timestamp || 0) !== Number(incoming.timestamp || 0)){
    try { sessionRequestPageCache?.clear?.(); } catch {}
  }
  const merged = { ...current, ...incoming };
  const oldRequests = Array.isArray(current.requestLog) ? current.requestLog : [];
  const newRequests = Array.isArray(incoming.requestLog) ? incoming.requestLog : [];
  const oldSessions = Array.isArray(current.sessions) ? current.sessions : [];
  const newSessions = Array.isArray(incoming.sessions) ? incoming.sessions : [];
  if(oldRequests.length > newRequests.length){
    merged.requestLog = mergeByKey(oldRequests, newRequests, requestKeyFor).sort((a, b) => (b.time || 0) - (a.time || 0) || requestKeyFor(a).localeCompare(requestKeyFor(b)));
    merged.requestPage = incoming.requestPage || { items: newRequests, total: incoming.requestTotal ?? newRequests.length };
  }
  if(oldSessions.length > newSessions.length){
    merged.sessions = mergeByKey(oldSessions, newSessions, sessionKeyFor).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || sessionKeyFor(a).localeCompare(sessionKeyFor(b)));
    merged.sessionPage = incoming.sessionPage || { items: newSessions, total: incoming.sessionTotal ?? newSessions.length };
  }
  return merged;
}

function usageScopeMatchesPayload(scope, payload){
  if(!scope || !payload) return false;
  const range = payload.range || {};
  if(String(scope.source || 'all') !== String(payload.source || 'all')) return false;
  if(String(scope.model || 'all') !== String(payload.model || 'all')) return false;
  if(String(scope.project || 'all') !== String(payload.project || 'all')) return false;
  if(String(scope.rangeKey || '') !== String(payload.rangeKey || '')) return false;
  const expectedStart = Number(payload.start ?? range.start ?? 0) || 0;
  const expectedEnd = Number(payload.endExclusive ?? payload.end ?? range.endExclusive ?? range.end ?? 0) || 0;
  return (Number(scope.start) || 0) === expectedStart
    && (Number(scope.endExclusive ?? scope.end) || 0) === expectedEnd;
}
function protectRealtimeSnapshotScope(current, incoming, payload, expectedAggregateScope){
  if(!current?.ok || !incoming?.ok) return { incoming, scopeMismatch: false };
  const queryScope = incoming.queryScope || incoming.usageScope || incoming.summaryFilter || null;
  const usageScope = incoming.usageScope || incoming.summaryFilter || null;
  const queryMatches = queryScope
    ? usageScopeMatchesPayload(queryScope, payload)
    : Boolean(incoming.aggregateScope && incoming.aggregateScope === expectedAggregateScope);
  const usageMatches = usageScope
    ? usageScopeMatchesPayload(usageScope, payload)
    : Boolean(incoming.aggregateScope && incoming.aggregateScope === expectedAggregateScope);
  const aggregateMatches = Boolean(incoming.aggregateScope && incoming.aggregateScope === expectedAggregateScope);
  if(queryMatches && usageMatches && aggregateMatches) return { incoming, scopeMismatch: false };
  const protectedIncoming = { ...incoming };
  const protectKeys = new Set();
  if(!queryMatches){
    for(const key of ['queryScope', 'requestLog', 'requestTotal', 'requestPage', 'sessions', 'sessionTotal', 'sessionPage']) protectKeys.add(key);
  }
  if(!queryMatches || !usageMatches){
    for(const key of ['usage', 'usageScope', 'status', 'quota', 'health', 'summaryOnly', 'summaryFilter']) protectKeys.add(key);
  }
  if(!queryMatches || !aggregateMatches){
    for(const key of ['sourceStats', 'models', 'trends', 'trendsSource', 'trendsScope', 'sessionSummary', 'aggregateScope', 'aggregateAt']) protectKeys.add(key);
  }
  for(const key of protectKeys){
    if(Object.prototype.hasOwnProperty.call(current, key)) protectedIncoming[key] = current[key];
    else delete protectedIncoming[key];
  }
  return { incoming: protectedIncoming, scopeMismatch: true };
}

// Realtime notifications must not rebuild the active workspace. The user may
// be typing, inspecting a row, or scrolled deep into a table when a new
// snapshot arrives, so only update data surfaces that have stable geometry.
function applyRealtimeSnapshot(incoming){
  const realtimeTimestamp = Number(incoming?.timestamp || snapshot?.timestamp || Date.now());
  if(realtimeTimestamp <= Number(lastRealtimeSnapshotTimestamp || 0)) return false;
  lastRealtimeSnapshotTimestamp = realtimeTimestamp;
  const currentScopeBase = snapshot?.ok ? { ...snapshot, timestamp: realtimeTimestamp } : null;
  const currentPayload = currentScopeBase ? dashboardPayloadForCurrentView(currentScopeBase) : null;
  const expectedAggregateScope = currentPayload ? trendScopeKey(currentPayload) : '';
  const protectedRealtime = protectRealtimeSnapshotScope(snapshot, incoming, currentPayload, expectedAggregateScope);
  const next = mergeLightSnapshotPayload(snapshot, protectedRealtime.incoming);
  if(!next?.ok) return false;
  if(!snapshot?.ok){
    render(next, { instantChart: true, windowLayout: false, partial: true, immediate: true });
    return true;
  }
  if(protectedRealtime.scopeMismatch){
    snapshot = next;
    analyticsDeferredToken += 1;
    if(layoutMode === 'dashboard' && workspaceMode === 'analytics'){
      scheduleDashboardAggregates(next, { forceAggregates: true, aggregateDelayMs: 0 });
    }
    return true;
  }

  const app = document.getElementById('app');
  const appScrollTop = Number(app?.scrollTop || 0);
  const appScrollLeft = Number(app?.scrollLeft || 0);
  const content = document.querySelector('.content');
  const contentScrollTop = Number(content?.scrollTop || 0);
  const contentScrollLeft = Number(content?.scrollLeft || 0);
  const sessionScroll = document.querySelector('.session-scroll');
  const sessionScrollTop = Number(sessionScroll?.scrollTop || 0);
  const sessionScrollLeft = Number(sessionScroll?.scrollLeft || 0);
  const active = document.activeElement;
  const activeSelection = active && typeof active.selectionStart === 'number' ? {
    start: active.selectionStart,
    end: active.selectionEnd,
  } : null;
  const restore = () => {
    if(app){ app.scrollTop = appScrollTop; app.scrollLeft = appScrollLeft; }
    const currentContent = document.querySelector('.content');
    if(currentContent){ currentContent.scrollTop = contentScrollTop; currentContent.scrollLeft = contentScrollLeft; }
    const currentSessionScroll = document.querySelector('.session-scroll');
    if(currentSessionScroll){
      currentSessionScroll.scrollTop = sessionScrollTop;
      currentSessionScroll.scrollLeft = sessionScrollLeft;
    }
    if(active && active.isConnected){
      try {
        active.focus({ preventScroll: true });
        if(activeSelection && typeof active.setSelectionRange === 'function') active.setSelectionRange(activeSelection.start, activeSelection.end);
      } catch {}
    }
  };

  // Invalidate deferred work scheduled for the previous snapshot. Those
  // callbacks intentionally check snapshot identity and will now no-op.
  snapshot = next;
  analyticsDeferredToken += 1;
  sessionTableItems = sessionTableItems || [];

  if(layoutMode === 'compact'){
    const rows = getFilteredRowsForView(next);
    const pane = document.querySelector('.compact-pane');
    if(pane && typeof renderCompactMenu === 'function' && typeof document.createElement === 'function'){
      const tmp = document.createElement('div');
      tmp.innerHTML = renderCompactMenu(next, rows);
      const nextPane = tmp.querySelector('.compact-pane');
      if(nextPane) pane.innerHTML = nextPane.innerHTML;
    }
  } else if(workspaceMode === 'analytics'){
    const rows = getFilteredRowsForView(next);
    // Keep the summary current, but leave filters, request rows and advanced
    // analysis untouched so their DOM identity and geometry remain stable.
    patchHtmlSlot('analyticsSummarySlot', renderSummary(rows, next));
    const canvas = document.getElementById('usageChart');
    if(canvas && typeof scheduleChartBind === 'function'){
      scheduleChartBind(rows, next, { instant: true, realtime: true }, 0, restore);
    }
  } else if(workspaceMode === 'sessions'){
    // The overview is a compact, fixed-height status strip. Keep the table and
    // inspector intact; replacing either would disrupt selection and scroll.
    patchSessionOverview(next);
    const selected = findSelectedSession?.();
    if(selected && typeof patchSessionInspectorInPlace === 'function'){
      const slot = document.getElementById('sessionInspectorSlot');
      patchSessionInspectorInPlace(slot, selected, sessionKeyFor(selected));
    }
  }

  restore();
  try { requestAnimationFrame(restore); } catch {}
  return true;
}
function shallowJsonEqual(a, b){
  try { return JSON.stringify(a || null) === JSON.stringify(b || null); } catch { return a === b; }
}
function aggregatePayloadForView(s, extra = {}){
  const selectedRange = typeof dateRangeForCurrentFilter === 'function'
    ? dateRangeForCurrentFilter(s)
    : { start: rangeFilter === 'all' ? 0 : sinceForRange(s), end: untilForRange(s) || rangeMinute(Number(s?.timestamp || Date.now())) };
  const start = selectedRange.start;
  const endExclusive = selectedRange.endExclusive ?? selectedRange.end;
  return {
    source: sourceFilter,
    model: modelFilter,
    project: analyticsProjectFilter,
    rangeKey: normalizeRangeFilter(rangeFilter),
    range: { start, end: endExclusive, endExclusive },
    start,
    end: endExclusive,
    endExclusive,
    timestamp: dashboardBoundaryTimestamp(),
    generation: dashboardRequestGeneration,
    windowHours: Number(s?.config?.windowHours || 24),
    bucketMs: typeof isDayRange === 'function' && isDayRange() ? 86400000 : 3600000,
    ...extra,
  };
}
function dashboardPayloadForCurrentView(s = snapshot || { timestamp: rendererNow(), config: { windowHours: 24 } }){
  return aggregatePayloadForView(s, {
    query: analyticsQuery,
    sessionQuery,
    status: sessionStatusFilter,
    project: workspaceMode === 'analytics' ? analyticsProjectFilter : sessionProjectFilter,
  });
}
function aggregateScopeForView(s = snapshot || {}){
  const bucketMs = isDayRange() ? 86400000 : 3600000;
  return trendScopeKey(aggregatePayloadForView(s, { bucketMs }));
}
function hasFreshAggregatesForView(s = snapshot || {}){
  if(!s?.aggregateScope || s.aggregateScope !== aggregateScopeForView(s)) return false;
  const age = Date.now() - Number(s.aggregateAt || s.timestamp || 0);
  return age >= 0 && age < 2500;
}
function dashboardAggregateInteractionActive(){
  try {
    const body = document.body;
    const app = document.getElementById('app');
    const now = Date.now();
    return now < Number(chartResizeQuietUntil || 0)
      || now < Number(zoomInteractionUntil || 0)
      || body?.classList?.contains?.('is-resizing')
      || body?.classList?.contains?.('is-zooming')
      || body?.classList?.contains?.('view-switching')
      || app?.classList?.contains?.('is-resizing')
      || app?.classList?.contains?.('is-zooming')
      || app?.classList?.contains?.('view-switching');
  } catch { return false; }
}
function dashboardAggregateDelay(opts = {}){
  if(Number.isFinite(Number(opts.aggregateDelayMs))) return Math.max(0, Number(opts.aggregateDelayMs));
  if(opts.sourceSwitch === true) return 220;
  if(opts.deferHeavy === true) return 180;
  if(dashboardAggregateInteractionActive()) return 260;
  return 90;
}
function runScheduledDashboardAggregates(s, token, opts = {}){
  if(token !== aggregateRefreshToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
  if(dashboardAggregateInteractionActive()){
    aggregateRefreshTimer = setTimeout(() => runScheduledDashboardAggregates(s, token, { ...opts, aggregateDelayMs: 140 }), 140);
    return;
  }
  refreshDashboardAggregates(s, token);
}
function scheduleDashboardAggregates(s, opts = {}){
  if(opts.skipAggregates || !s?.ok || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
  if(opts.forceAggregates !== true && hasFreshAggregatesForView(s)) return;
  if(aggregateRefreshTimer) clearTimeout(aggregateRefreshTimer);
  const token = ++aggregateRefreshToken;
  aggregateRefreshTimer = setTimeout(() => runScheduledDashboardAggregates(s, token, opts), dashboardAggregateDelay(opts));
}
async function refreshDashboardAggregates(s, token){
  try {
    const dayMode = isDayRange();
    const bucketMs = dayMode ? 86400000 : 3600000;
    const basePayload = aggregatePayloadForView(s, { bucketMs });
    const ticket = captureDashboardRequest(basePayload);
    const aggregate = await ipcRenderer.invoke('dashboard:getAggregates', basePayload);
    if(token !== aggregateRefreshToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics' || !dashboardRequestIsCurrent(ticket)) return;
    const nextTrendScope = trendScopeKey(basePayload);
    const partialAggregate = aggregate?.ok && Array.isArray(aggregate.sourceErrors) && aggregate.sourceErrors.length > 0;
    const existingScope = s.usageScope || s.queryScope || s.summaryFilter;
    const preserveCompleteAggregate = partialAggregate && s.usage && usageScopeMatchesPayload(existingScope, basePayload);
    if(aggregate?.ok && !preserveCompleteAggregate){
      s.aggregateScope = nextTrendScope;
      s.aggregateAt = Date.now();
    }
    const nextUsageScope = {
      source: basePayload.source || 'all',
      model: basePayload.model || 'all',
      project: basePayload.project || 'all',
      rangeKey: basePayload.rangeKey || '',
      start: Number(basePayload.start ?? basePayload.range?.start ?? 0) || 0,
      end: Number(basePayload.endExclusive ?? basePayload.end ?? basePayload.range?.endExclusive ?? basePayload.range?.end ?? 0) || 0,
      endExclusive: Number(basePayload.endExclusive ?? basePayload.end ?? basePayload.range?.endExclusive ?? basePayload.range?.end ?? 0) || 0,
    };
    const changes = { summary: false, trend: false, sourceStats: false, modelStats: false, sessionSummary: false };
    let changed = false;
    if(aggregate?.ok && aggregate.usage && !preserveCompleteAggregate){
      if(!shallowJsonEqual(s.usage, aggregate.usage)){ s.usage = aggregate.usage; changes.summary = true; changed = true; }
      s.usageScope = nextUsageScope;
      s.summaryOnly = false;
      s.summaryFilter = null;
    }
    if(aggregate?.ok && Array.isArray(aggregate.buckets) && !preserveCompleteAggregate){
      const currentTrend = dayMode ? s.trends?.daily14d : s.trends?.hourly24h;
      if(!shallowJsonEqual(currentTrend, aggregate.buckets) || s.trendsScope !== nextTrendScope){
        s.trends = { ...(s.trends || {}) };
        if(dayMode) s.trends.daily14d = aggregate.buckets;
        else s.trends.hourly24h = aggregate.buckets;
        s.trendsSource = 'db-aggregate';
        s.trendsScope = nextTrendScope;
        changes.trend = true;
        changed = true;
      }
    }
    if(aggregate?.ok && Array.isArray(aggregate.sourceStats) && !preserveCompleteAggregate){
      s.sourceStatsScope = { ...nextUsageScope, complete: true };
      if(!shallowJsonEqual(s.sourceStats, aggregate.sourceStats)){ s.sourceStats = aggregate.sourceStats; changes.sourceStats = true; changed = true; }
    }
    if(aggregate?.ok && Array.isArray(aggregate.modelStats) && !preserveCompleteAggregate){
      s.modelsScope = { ...nextUsageScope, complete: true };
      if(!shallowJsonEqual(s.models, aggregate.modelStats)){
        s.models = aggregate.modelStats;
        try { memoForSnapshot(s).modelOptions = null; } catch {}
        changes.modelStats = true;
        changed = true;
      }
    }
    if(aggregate?.ok && aggregate.sessionSummary && !preserveCompleteAggregate && !shallowJsonEqual(s.sessionSummary, aggregate.sessionSummary)){ s.sessionSummary = aggregate.sessionSummary; changes.sessionSummary = true; changed = true; }
    if(partialAggregate) s.sourceErrors = aggregate.sourceErrors;
    if(aggregate?.nativeError) s.nativeError = aggregate.nativeError;
    if(changed){
      if(!patchDashboardAggregateSlots(s, changes)){
        render(s, { windowLayout: false, instantChart: true, partial: true, skipAggregates: true });
      }
    }
  } catch (error) {
    ipcRenderer.invoke('dashboard:log', { level: 'warn', scope: 'renderer:aggregates', message: error.message }).catch(() => {});
  }
}


function setRefreshState(text){ const el = document.getElementById('refreshState'); if(el) el.textContent = text || ''; }
function toast(text, timeout = 900){
  setRefreshState(text || '');
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => setRefreshState(''), timeout);
}
function applyCustomDateInputs(){
  if(typeof dateRangeDraftValidation === 'function'){
    dateRangeError = dateRangeDraftValidation();
    if(dateRangeError) return false;
  }
  if(dateRangeDraftStart) customDateStart = dateRangeDraftStart;
  if(dateRangeDraftEnd) customDateEnd = dateRangeDraftEnd;
  normalizeCustomDateRange(snapshot || {});
  rangeFilter = 'customTime';
  localStorage.setItem('statsRange', rangeFilter);
  localStorage.setItem('customDateStart', String(customDateStart));
  localStorage.setItem('customDateEnd', String(customDateEnd));
  dateRangeError = '';
  return true;
}
function setupAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); const sec = Math.max(5, Number(refreshEvery) || 30); autoRefreshTimer = setInterval(refreshNow, sec * 1000); }
function initialSkeletonState(){
  return {
    ok: true,
    timestamp: rendererNow(),
    config: { dailyLimit: 200000, windowHours: 24 },
    sources: [],
    usage: { today: {}, window: {}, week: {}, all: {} },
    models: [],
    sourceStats: [],
    trends: {},
    sessionSummary: { total: 0, active: 0, archived: 0, visible: 0 },
    requestLog: [],
    sessions: [],
    requestTotal: 0,
    sessionTotal: 0,
    summaryPending: true,
  };
}
function renderInitialSkeleton(){
  const app = document.getElementById('app');
  if(!app) return;
  const s = initialSkeletonState();
  snapshot = s;
  const summary = `<section class="summary-card usage-summary summary-skeleton" aria-label="${esc(TXT.loading || '\u6b63\u5728\u52a0\u8f7d\u6458\u8981')}"><div class="summary-skeleton-hero"><i></i><div><span></span><b></b></div><em></em></div><div class="summary-skeleton-grid">${Array.from({ length: 5 }, () => '<span></span>').join('')}</div></section>`;
  const details = `<div class="startup-deferred"><span>${esc(TXT.updatingDetails || '\u6b63\u5728\u540e\u53f0\u52a0\u8f7d\u8d8b\u52bf\u4e0e\u6a21\u578b\u7edf\u8ba1...')}</span></div>`;
  commitAppHtml(app, `${headerHtml(false)}<div id="analyticsFiltersSlot">${filtersHtml(s)}</div><div id="analyticsSummarySlot">${summary}</div><div id="analyticsEmptySlot"></div><div id="analyticsChartSlot">${details}</div><div id="analyticsAgentSlot"></div><div id="analyticsTableSlot"></div><div id="analyticsAdvancedSlot"></div><div id="analyticsDiagnosticsSlot"></div>`);
  syncFooter();
  applyWindowLayout();
}
async function load(){
  beginDashboardRequestGeneration();
  const payload = dashboardPayloadForCurrentView();
  const ticket = captureDashboardRequest(payload);
  if(layoutMode !== 'dashboard' || workspaceMode !== 'analytics'){
    setRefreshState(TXT.refresh);
    const first = await ipcRenderer.invoke('dashboard:getSnapshot', payload);
    if(!dashboardRequestIsCurrent(ticket)){ setupAutoRefresh(); return; }
    render(first, { immediate: true, instantChart: true, deferHeavy: true });
    if(!first?.ok) await refreshNow();
    setupAutoRefresh();
    return;
  }
  renderInitialSkeleton();
  setRefreshState(TXT.refresh);
  let slowCacheTimer = null;
  let initialSummarySettled = false;
  const runtimePromise = ipcRenderer.invoke('dashboard:getRuntimeInfo').catch(() => null);
  runtimePromise.then((runtime) => {
    if(initialSummarySettled || runtime?.preferred !== 'sql.js') return;
    slowCacheTimer = setTimeout(() => {
      if(initialSummarySettled) return;
      document.body?.classList?.add?.('cache-building');
      setRefreshState(TXT.buildingCache || '\u6b63\u5728\u5efa\u7acb\u7f13\u5b58...');
    }, 300);
  });
  try {
    let first = await ipcRenderer.invoke('dashboard:getInitialSummary', payload);
    if(!first?.ok) first = await ipcRenderer.invoke('dashboard:getSnapshot', payload);
    if(!dashboardRequestIsCurrent(ticket)){
      initialSummarySettled = true;
      if(slowCacheTimer) clearTimeout(slowCacheTimer);
      document.body?.classList?.remove?.('cache-building');
      setupAutoRefresh();
      return;
    }
    initialSummarySettled = true;
    if(slowCacheTimer) clearTimeout(slowCacheTimer);
    document.body?.classList?.remove?.('cache-building');
    render(first, { immediate: true, instantChart: true, deferHeavy: true, skipAggregates: true });
    if(!first?.ok){ await refreshNow(); setupAutoRefresh(); return; }
    setRefreshState(TXT.loadingBackgroundStats || '\u6458\u8981\u5df2\u5c31\u7eea\uff0c\u6b63\u5728\u540e\u53f0\u52a0\u8f7d\u8d8b\u52bf\u4e0e\u6a21\u578b\u7edf\u8ba1...');
    ipcRenderer.invoke('dashboard:getSnapshot', payload).then((full) => {
      if(!full?.ok || !dashboardRequestIsCurrent(ticket)) return;
      render(mergeLightSnapshotPayload(snapshot, full), { instantChart: true, partial: true, skipAggregates: true });
      setRefreshState(TXT.refreshed);
      setTimeout(() => setRefreshState(''), 800);
    }).catch((error) => {
      if(!dashboardRequestIsCurrent(ticket)) return;
      ipcRenderer.invoke('dashboard:log', { level: 'warn', scope: 'renderer:initial-background', message: error.message }).catch(() => {});
      setRefreshState('');
    });
  } catch (error) {
    initialSummarySettled = true;
    if(slowCacheTimer) clearTimeout(slowCacheTimer);
    document.body?.classList?.remove?.('cache-building');
    await refreshNow();
  }
  setupAutoRefresh();
}
async function refreshNow(opts = {}){
  const requested = opts && typeof opts === 'object' && !opts.type ? opts : {};
  const currentPayload = dashboardPayloadForCurrentView(snapshot?.ok ? snapshot : undefined);
  const currentScope = `${requested.full === true ? 'full' : 'light'}|${dashboardRequestGeneration}|${dashboardPayloadScopeKey(currentPayload)}`;
  if(refreshInFlight && refreshInFlightScope === currentScope) return refreshInFlight;
  beginDashboardRequestGeneration();
  // Capture the user's position before IPC can give the browser a chance to
  // anchor the scroll container around an asynchronously changing shell.
  const capturedScrollTop = Number(document.getElementById('app')?.scrollTop || 0);
  const renderOpts = {
    windowLayout: false,
    instantChart: true,
    partial: true,
    preserveFilters: true,
    preserveRefreshState: true,
    preserveScrollTop: Number.isFinite(Number(requested.preserveScrollTop)) ? Number(requested.preserveScrollTop) : capturedScrollTop,
    ...requested,
  };
  const payload = dashboardPayloadForCurrentView(snapshot?.ok ? snapshot : undefined);
  const ticket = captureDashboardRequest(payload);
  const requestScope = `${renderOpts.full === true ? 'full' : 'light'}|${dashboardRequestGeneration}|${dashboardPayloadScopeKey(payload)}`;
  refreshInFlightScope = requestScope;
  const requestPromise = (async () => {
    setRefreshState(TXT.refresh);
    document.body?.classList?.add?.('is-refreshing');
    try {
      const channel = renderOpts.full === true ? 'dashboard:refreshFull' : 'dashboard:refreshLight';
      const incoming = await ipcRenderer.invoke(channel, payload);
      if(!dashboardRequestIsCurrent(ticket)) return null;
      const next = mergeLightSnapshotPayload(snapshot, incoming);
      render(next, renderOpts);
      await new Promise((resolve) => schedulePostCommit(resolve, 80));
      if(!dashboardRequestIsCurrent(ticket)) return null;
      setRefreshState(TXT.refreshed);
      setTimeout(() => setRefreshState(''), 800);
      return next;
    } catch (error) {
      if(dashboardRequestIsCurrent(ticket)){
        setRefreshState(TXT.failed || '\u5237\u65b0\u5931\u8d25');
        ipcRenderer.invoke('dashboard:log', { level: 'warn', scope: 'renderer:refresh', message: error?.message || String(error) }).catch(() => {});
      }
      return null;
    } finally {
      if(refreshInFlight === requestPromise){
        document.body?.classList?.remove?.('is-refreshing');
        refreshInFlight = null;
        refreshInFlightScope = '';
      }
    }
  })();
  refreshInFlight = requestPromise;
  return refreshInFlight;
}
