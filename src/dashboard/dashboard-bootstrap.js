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
    merged.requestLog = mergeByKey(oldRequests, newRequests, requestKeyFor).sort((a, b) => (b.time || 0) - (a.time || 0));
    merged.requestPage = incoming.requestPage || { items: newRequests, total: incoming.requestTotal ?? newRequests.length };
  }
  if(oldSessions.length > newSessions.length){
    merged.sessions = mergeByKey(oldSessions, newSessions, sessionKeyFor).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    merged.sessionPage = incoming.sessionPage || { items: newSessions, total: incoming.sessionTotal ?? newSessions.length };
  }
  return merged;
}

// Realtime notifications must not rebuild the active workspace. The user may
// be typing, inspecting a row, or scrolled deep into a table when a new
// snapshot arrives, so only update data surfaces that have stable geometry.
function applyRealtimeSnapshot(incoming){
  if(typeof cancelDateRangeScrollRestore === 'function') cancelDateRangeScrollRestore();
  if(typeof dateRangeScrollState !== 'undefined' && dateRangeScrollState) dateRangeScrollState = null;
  if(typeof chartAnimationFrame !== 'undefined' && chartAnimationFrame){
    cancelAnimationFrame(chartAnimationFrame);
    chartAnimationFrame = null;
  }
  if(typeof chartHoverFrame !== 'undefined' && chartHoverFrame){
    cancelAnimationFrame(chartHoverFrame);
    chartHoverFrame = null;
  }
  if(typeof clearChartHover === 'function') clearChartHover({ redraw: false, clearPinned: true });
  if(typeof chartBindToken !== 'undefined') chartBindToken += 1;
  if(typeof chartBindTimer !== 'undefined' && chartBindTimer){
    clearTimeout(chartBindTimer);
    chartBindTimer = null;
  }
  const next = mergeLightSnapshotPayload(snapshot, incoming);
  if(!next?.ok) return false;
  if(!snapshot?.ok){
    render(next, { instantChart: true, windowLayout: false, partial: true, immediate: true });
    return true;
  }

  const app = document.getElementById('app');
  const appScrollTop = Number(app?.scrollTop || 0);
  const appScrollLeft = Number(app?.scrollLeft || 0);
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
  setTimeout(restore, 0);
  setTimeout(restore, 32);
  setTimeout(restore, 96);
  setTimeout(restore, 180);
  setTimeout(restore, 320);
  setTimeout(restore, 520);
  setTimeout(restore, 800);
  return true;
}
function shallowJsonEqual(a, b){
  try { return JSON.stringify(a || null) === JSON.stringify(b || null); } catch { return a === b; }
}
function aggregatePayloadForView(s, extra = {}){
  const start = rangeFilter === 'all' ? 0 : sinceForRange(s);
  const end = untilForRange(s) || Number(s?.timestamp || Date.now());
  return {
    source: sourceFilter,
    model: modelFilter,
    rangeKey: normalizeRangeFilter(rangeFilter),
    range: { start, end },
    start,
    end,
    timestamp: Number(s?.timestamp || Date.now()),
    windowHours: Number(s?.config?.windowHours || 24),
    bucketMs: typeof isDayRange === 'function' && isDayRange() ? 86400000 : 3600000,
    ...extra,
  };
}
function dashboardPayloadForCurrentView(s = snapshot || { timestamp: Date.now(), config: { windowHours: 24 } }){
  return aggregatePayloadForView(s, {
    query: analyticsQuery,
    sessionQuery,
    status: sessionStatusFilter,
    project: sessionProjectFilter,
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
  if(hasFreshAggregatesForView(s)) return;
  if(aggregateRefreshTimer) clearTimeout(aggregateRefreshTimer);
  const token = ++aggregateRefreshToken;
  aggregateRefreshTimer = setTimeout(() => runScheduledDashboardAggregates(s, token, opts), dashboardAggregateDelay(opts));
}
async function refreshDashboardAggregates(s, token){
  try {
    const dayMode = isDayRange();
    const bucketMs = dayMode ? 86400000 : 3600000;
    const basePayload = aggregatePayloadForView(s, { bucketMs });
    const aggregate = await ipcRenderer.invoke('dashboard:getAggregates', basePayload);
    if(token !== aggregateRefreshToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
    const nextTrendScope = trendScopeKey(basePayload);
    if(aggregate?.ok){
      s.aggregateScope = nextTrendScope;
      s.aggregateAt = Date.now();
    }
    const changes = { summary: false, trend: false, sourceStats: false, modelStats: false, sessionSummary: false };
    let changed = false;
    if(aggregate?.ok && aggregate.usage && !shallowJsonEqual(s.usage, aggregate.usage)){ s.usage = aggregate.usage; changes.summary = true; changed = true; }
    if(aggregate?.ok && Array.isArray(aggregate.buckets)){
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
    if(aggregate?.ok && Array.isArray(aggregate.sourceStats) && !shallowJsonEqual(s.sourceStats, aggregate.sourceStats)){ s.sourceStats = aggregate.sourceStats; changes.sourceStats = true; changed = true; }
    if(aggregate?.ok && Array.isArray(aggregate.modelStats) && !shallowJsonEqual(s.models, aggregate.modelStats.slice(0, 12))){
      s.models = aggregate.modelStats.slice(0, 12);
      try { memoForSnapshot(s).modelOptions = null; } catch {}
      changes.modelStats = true;
      changed = true;
    }
    if(aggregate?.ok && aggregate.sessionSummary && !shallowJsonEqual(s.sessionSummary, aggregate.sessionSummary)){ s.sessionSummary = aggregate.sessionSummary; changes.sessionSummary = true; changed = true; }
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
    timestamp: Date.now(),
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
  const payload = dashboardPayloadForCurrentView();
  if(layoutMode !== 'dashboard' || workspaceMode !== 'analytics'){
    setRefreshState(TXT.refresh);
    const first = await ipcRenderer.invoke('dashboard:getSnapshot', payload);
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
    initialSummarySettled = true;
    if(slowCacheTimer) clearTimeout(slowCacheTimer);
    document.body?.classList?.remove?.('cache-building');
    render(first, { immediate: true, instantChart: true, deferHeavy: true, skipAggregates: true });
    if(!first?.ok){ await refreshNow(); setupAutoRefresh(); return; }
    setRefreshState(TXT.loadingBackgroundStats || '\u6458\u8981\u5df2\u5c31\u7eea\uff0c\u6b63\u5728\u540e\u53f0\u52a0\u8f7d\u8d8b\u52bf\u4e0e\u6a21\u578b\u7edf\u8ba1...');
    ipcRenderer.invoke('dashboard:getSnapshot', payload).then((full) => {
      if(!full?.ok) return;
      render(mergeLightSnapshotPayload(snapshot, full), { instantChart: true, partial: true, skipAggregates: true });
      setRefreshState(TXT.refreshed);
      setTimeout(() => setRefreshState(''), 800);
    }).catch((error) => {
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
  if(refreshInFlight) return refreshInFlight;
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
  refreshInFlight = (async () => {
    setRefreshState(TXT.refresh);
    document.body?.classList?.add?.('is-refreshing');
    try {
      const payload = dashboardPayloadForCurrentView(snapshot?.ok ? snapshot : undefined);
      const channel = renderOpts.full === true ? 'dashboard:refreshFull' : 'dashboard:refreshLight';
      const next = mergeLightSnapshotPayload(snapshot, await ipcRenderer.invoke(channel, payload));
      render(next, renderOpts);
      await new Promise((resolve) => schedulePostCommit(resolve, 80));
      setRefreshState(TXT.refreshed);
      setTimeout(() => setRefreshState(''), 800);
      return next;
    } catch (error) {
      setRefreshState(TXT.failed || '\u5237\u65b0\u5931\u8d25');
      ipcRenderer.invoke('dashboard:log', { level: 'warn', scope: 'renderer:refresh', message: error?.message || String(error) }).catch(() => {});
      return null;
    } finally {
      document.body?.classList?.remove?.('is-refreshing');
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
