const ipcRenderer = window.codeartsApi;
if(!ipcRenderer || typeof ipcRenderer.invoke !== 'function') throw new Error('Dashboard preload API unavailable');

function rendererNow(){
  const injected = Number(window.codeartsTestNowMs || 0);
  return Number.isFinite(injected) && injected > 0 ? injected : Date.now();
}

function serializeRendererError(error){
  if(error instanceof Error) return { name: error.name || 'Error', message: error.message || String(error), stack: error.stack || '' };
  if(error && typeof error === 'object'){
    let raw = null;
    try { raw = JSON.parse(JSON.stringify(error)); } catch {}
    return { name: String(error.name || 'Error'), message: String(error.message || error.reason || error.error || JSON.stringify(raw || error)), stack: String(error.stack || ''), raw };
  }
  return { name: 'Error', message: String(error || 'Unknown renderer error'), stack: '' };
}
function installRendererErrorReporting(){
  if(typeof window === 'undefined' || window.__codeartsRendererErrorReportingInstalled) return;
  window.__codeartsRendererErrorReportingInstalled = true;
  let lastKey = '';
  let lastAt = 0;
  function report(type, error, detail = {}){
    const payload = serializeRendererError(error);
    const key = `${type}:${payload.message}:${detail.filename || ''}:${detail.lineno || ''}:${detail.colno || ''}`;
    const now = Date.now();
    if(key === lastKey && now - lastAt < 2000) return;
    lastKey = key;
    lastAt = now;
    ipcRenderer.invoke('dashboard:rendererError', { type, error: payload, detail }).catch(() => {
      ipcRenderer.invoke('dashboard:log', { level: 'error', scope: `renderer:${type}`, message: payload.message, detail }).catch(() => {});
    });
  }
  window.addEventListener('error', (event) => {
    report('window_error', event.error || event.message, {
      message: event.message || '',
      filename: event.filename || '',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    report('unhandled_rejection', event.reason || 'Unhandled rejection', { promise: true });
  });
}
installRendererErrorReporting();


let snapshot = null;
let copyResetTimer = null;
let autoRefreshTimer = null;
let refreshInFlight = null;
let refreshInFlightScope = '';
let dashboardRequestGeneration = 0;
let dashboardScopeTimestamp = rendererNow();
let lastRealtimeSnapshotTimestamp = 0;
let sourceFilter = localStorage.getItem('statsSource') || 'all';
let modelFilter = localStorage.getItem('statsModel') || 'all';
let analyticsProjectFilter = localStorage.getItem('statsProject') || 'all';
let rangeFilter = localStorage.getItem('statsRange') || 'today';
let customRangeDays = Math.max(2, Math.min(365, Number(localStorage.getItem('customRangeDays') || '60') || 60));
let customDateStart = Number(localStorage.getItem('customDateStart') || 0) || (rendererNow() - 86400000);
let customDateEnd = Number(localStorage.getItem('customDateEnd') || 0) || rendererNow();
let dateRangeOpen = false;
let dateRangeDraftStart = 0;
let dateRangeDraftEnd = 0;
let dateRangeError = '';
let dateRangeFocus = 'start';
let dateRangeMonth = Number(localStorage.getItem('dateRangeMonth') || 0) || 0;
let tableTab = localStorage.getItem('statsTableTab') || 'requests';
let workspaceMode = 'analytics';
try { localStorage.setItem('workspaceMode', workspaceMode); } catch {}
let analyticsQuery = localStorage.getItem('statsAnalyticsQuery') || localStorage.getItem('statsQuery') || '';
let sessionQuery = localStorage.getItem('statsSessionQuery') || '';
let sessionStatusFilter = localStorage.getItem('sessionStatusFilter') || 'active';
let sessionSort = localStorage.getItem('sessionSort') || 'updated';
let sessionTagFilter = localStorage.getItem('sessionTagFilter') || 'all';
let sessionQuickFilter = localStorage.getItem('sessionQuickFilter') || 'all';
let sessionProjectFilter = localStorage.getItem('sessionProjectFilter') || 'all';
let analyticsAdvancedOpen = localStorage.getItem('analyticsAdvancedOpen') === '1';
let selectedSessionId = localStorage.getItem('selectedSessionId') || '';
let selectedSessionKeys = new Set((localStorage.getItem('selectedSessionKeys') || '').split('|').filter(Boolean));
let selectedSessionRecords = new Map();
let pinnedSessionKeys = new Set((localStorage.getItem('pinnedSessionKeys') || '').split('|').filter(Boolean));
let renameSessionKey = '';
let renameDraft = '';
let bulkMetaOpen = false;
let bulkMetaTagsDraft = '';
let bulkMetaNoteDraft = '';
let exportDialog = null;
let savedSessionViews = [];
let savedSessionViewNameDraft = '';
let sessionAdvancedOpen = false;
try { localStorage.removeItem('sessionAdvancedOpen'); } catch {}
let selectedRequestKey = localStorage.getItem('selectedRequestKey') || '';
let refreshEvery = localStorage.getItem('statsRefreshEvery') || '30';
let layoutMode = localStorage.getItem('layoutMode') || 'dashboard';
let zoom = Number(localStorage.getItem('uiZoom') || '1');
let compactPane = localStorage.getItem('compactPane') || 'overview';
let compactPinned = localStorage.getItem('compactPinned') === '1';
try { localStorage.removeItem('compactOpacity'); } catch {}
let chartPoints = [];
let chartAnimationFrame = null;
let chartHoverFrame = null;
let chartHover = { idx: -1, x: NaN, y: NaN, tx: NaN, ty: NaN, focusKey: '', pulse: 0 };
let chartPinnedIndex = -1;
let lastChartTipKey = '';
let lastChartHoverKey = '';
let sessionTableItems = [];
let lastToastTimer = null;
let lastWindowLayoutApplied = '';
let lastRenderMode = '';
let suppressChartIntro = false;
let resizeFrame = null;
let resizeFrameTimer = null;
let resizeTimer = null;
let resizePerfSession = null;
let resizePerfLogTimer = null;
let queryRenderTimer = null;
let analyticsDeferredToken = 0;
const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
function normalizeTablePageSize(value, fallback = 50){
  const n = Number(value);
  return TABLE_PAGE_SIZE_OPTIONS.includes(n) ? n : fallback;
}
function maxTablePageIndex(total, pageSize){
  return Math.max(0, Math.ceil(Math.max(0, Number(total || 0)) / Math.max(1, Number(pageSize || 1))) - 1);
}
function normalizePageInputToIndex(value, total, pageSize, fallback = 0){
  const raw = String(value ?? '').trim();
  if(!raw) return Math.max(0, Math.min(maxTablePageIndex(total, pageSize), Number(fallback || 0)));
  const n = Math.floor(Number(raw));
  if(!Number.isFinite(n)) return Math.max(0, Math.min(maxTablePageIndex(total, pageSize), Number(fallback || 0)));
  if(n < 1) return 0;
  return Math.max(0, Math.min(maxTablePageIndex(total, pageSize), n - 1));
}
function clampTablePageIndex(value, total, pageSize){
  const n = Math.floor(Number(value));
  return Math.max(0, Math.min(maxTablePageIndex(total, pageSize), Number.isFinite(n) ? n : 0));
}
let SESSION_PAGE_SIZE = normalizeTablePageSize(localStorage.getItem('sessionPageSize'), 50);
let REQUEST_PAGE_SIZE = normalizeTablePageSize(localStorage.getItem('requestPageSize'), 100);
let requestTableRenderLimit = REQUEST_PAGE_SIZE;
let sessionTableRenderLimit = SESSION_PAGE_SIZE;
let requestTablePage = Math.max(0, Number(localStorage.getItem('requestTablePage') || '0') || 0);
let sessionTablePage = Math.max(0, Number(localStorage.getItem('sessionTablePage') || '0') || 0);
let requestPageLoading = false;
let sessionPageLoading = false;
let requestPageLoadToken = 0;
let sessionPageLoadToken = 0;
let requestPageCache = { key: '', items: null, total: 0, page: 0, timestamp: 0 };
let sessionPageCache = { key: '', items: null, total: 0, page: 0, timestamp: 0 };
let pagedTableFeedback = { requests: '', sessions: '' };
let pagedTableFeedbackTimers = { requests: null, sessions: null };
let sessionRequestPageCache = new Map();
let sessionRequestPageInflight = new Map();
let sessionPageRefreshTimer = null;
let lastRenderPerf = null;
let currentRenderPerf = null;
let tableScrollBindFrame = null;
let perfPanelOpen = localStorage.getItem('perfPanelOpen') === '1';
let perfDiagnostics = null;
let perfDiagnosticsLoading = false;
let perfDiagnosticsFetchedAt = 0;
let aggregateRefreshToken = 0;
let aggregateRefreshTimer = null;
let renderScheduleFrame = null;
let renderScheduleTimer = null;
let renderScheduled = false;
let pendingRenderState = null;
let pendingRenderOptions = null;
let renderCommitToken = 0;
let appScrollRestoreToken = 0;
let appScrollRestoreFrame = null;
let appScrollRestoreTimer = null;
let lastFilteredRows = [];
let lastFilteredSnapshot = null;
let lastFilteredModeKey = '';
let slotHtmlCache = new Map();
let chartResizeObserver = null;
let chartResizeObservedCanvas = null;
let chartResizeSizeKey = '';
let zoomInteractionUntil = 0;
let chartCanvasBoxCache = { width: 0, height: 0, dpr: 0, key: '', timestamp: 0, source: '' };
let chartGeometryDirty = false;
let chartBindTimer = null;
let chartBindFrame = null;
let chartBindIdle = null;
let chartBindFallbackTimer = null;
let chartBindToken = 0;
let chartZoomSettleTimer = null;
let chartResizeSettleTimer = null;
let chartResizeQuietUntil = 0;
let lastChartDrawSignature = '';
let chartStableBucketCache = new Map();
let sessionHydrationItems = [];
let sessionHydrationToken = 0;
let sessionBulkPatchFrame = null;
let sessionInspectorPatchToken = 0;
let sessionInspectorPatchTimer = null;
let analyticsDeferredTasks = new Set();
let lastSessionSelectedRowKey = '';
let storedChartSeries = localStorage.getItem('chartSeries') || '';
if(localStorage.getItem('chartSeriesLeanMigrated') !== '1'){
  if(!storedChartSeries || storedChartSeries === 'total,input,output,cacheHitRate') storedChartSeries = 'total,input,output,cacheRead';
  localStorage.setItem('chartSeries', storedChartSeries);
  localStorage.setItem('chartSeriesLeanMigrated', '1');
}
if(localStorage.getItem('chartSeriesMinimalMigrated') !== '1'){
  const chosen = new Set(String(storedChartSeries || '').split(',').filter(Boolean));
  if(!chosen.size || chosen.has('cacheHitRate') || chosen.has('cacheWrite') || chosen.has('ttftMs') || chosen.has('waitMs') || chosen.has('queueMs')){
    storedChartSeries = 'total,input,output,cacheRead';
    localStorage.setItem('chartSeries', storedChartSeries);
  }
  localStorage.setItem('chartSeriesMinimalMigrated', '1');
}
if(localStorage.getItem('chartSeriesTokenOnlyMigrated') !== '1'){
  const chosen = new Set(String(storedChartSeries || '').split(',').filter(Boolean));
  if(!chosen.size || chosen.has('cacheHitRate') || !chosen.has('cacheRead')){
    storedChartSeries = 'total,input,output,cacheRead';
    localStorage.setItem('chartSeries', storedChartSeries);
  }
  localStorage.setItem('chartSeriesTokenOnlyMigrated', '1');
}
let visibleSeries = new Set((storedChartSeries || 'total,input,output,cacheRead').split(',').filter(Boolean));
let sessionMeta = {};
const prefersReducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
if(workspaceMode === 'analytics' && tableTab === 'sessions'){
  tableTab = 'requests';
  localStorage.setItem('statsTableTab', tableTab);
}

/* @dashboard-include dashboard/i18n.js */
/* @dashboard-include-list
core/cacheMetrics.js
dashboard/date-range-core.js
dashboard-state.js
dashboard-date-range.js
dashboard/analytics/analytics-core.js
dashboard/analytics/analytics-agent-idle.js
dashboard-analytics.js
core/chart-axis.js
dashboard/chart/chart-series.js
dashboard/chart/chart-legend.js
dashboard/chart/chart-canvas.js
dashboard/chart/chart-tooltip.js
dashboard/chart/chart-hover.js
dashboard-chart.js
dashboard-sessions.js
*/
/* @dashboard-include-list
dashboard/dashboard-shell.js
dashboard/dashboard-error-state.js
dashboard/dashboard-diagnostics.js
dashboard/dashboard-bootstrap.js
*/
let lastCommittedHtml = '';
let lastRenderCost = 0;
/* @dashboard-include dashboard/dashboard-perf.js */
/* @dashboard-include-list
dashboard/dashboard-slots.js
dashboard/slots/slot-core.js
dashboard/slots/analytics-slots.js
dashboard/slots/data-page-core.js
dashboard/slots/request-page-slot.js
dashboard/slots/session-page-slot.js
dashboard/slots/session-slots.js
dashboard/slots/perf-panel-slot.js
*/
function mergeRenderOptions(prev = {}, next = {}){
  prev = prev || {};
  next = next || {};
  const merged = { ...prev, ...next };
  if(prev.windowLayout === false || next.windowLayout === false) merged.windowLayout = false;
  if(prev.instantChart || next.instantChart) merged.instantChart = true;
  if(prev.deferHeavy || next.deferHeavy) merged.deferHeavy = true;
  if(prev.partial || next.partial) merged.partial = true;
  if(prev.skipAggregates || next.skipAggregates) merged.skipAggregates = true;
  if(prev.preserveFilters || next.preserveFilters) merged.preserveFilters = true;
  if(prev.preserveRefreshState || next.preserveRefreshState) merged.preserveRefreshState = true;
  return merged;
}
function render(s, opts = {}){
  if(opts.immediate === true) return renderImmediate(s, opts);
  pendingRenderState = s;
  pendingRenderOptions = mergeRenderOptions(pendingRenderOptions, opts);
  if(renderScheduled) return;
  renderScheduled = true;
  const flush = () => {
    if(!renderScheduled) return;
    renderScheduled = false;
    if(renderScheduleFrame){ try { cancelAnimationFrame(renderScheduleFrame); } catch {} }
    if(renderScheduleTimer) clearTimeout(renderScheduleTimer);
    renderScheduleFrame = null;
    renderScheduleTimer = null;
    const nextState = pendingRenderState;
    const nextOptions = pendingRenderOptions || {};
    pendingRenderState = null;
    pendingRenderOptions = null;
    renderImmediate(nextState, nextOptions);
  };
  renderScheduleFrame = requestAnimationFrame(flush);
  renderScheduleTimer = setTimeout(flush, 48);
}
function cancelPendingAppScrollRestore(){
  appScrollRestoreToken += 1;
  if(appScrollRestoreFrame){ try { cancelAnimationFrame(appScrollRestoreFrame); } catch {} }
  if(appScrollRestoreTimer) clearTimeout(appScrollRestoreTimer);
  appScrollRestoreFrame = null;
  appScrollRestoreTimer = null;
}
function preserveAppScroll(app, scrollTop){
  if(!app || !Number.isFinite(scrollTop)) return;
  cancelPendingAppScrollRestore();
  const token = appScrollRestoreToken;
  const restore = () => {
    if(token !== appScrollRestoreToken) return;
    if(Math.abs(Number(app.scrollTop || 0) - scrollTop) > 0.5) app.scrollTop = scrollTop;
  };
  restore();
  try {
    appScrollRestoreFrame = requestAnimationFrame(() => {
      appScrollRestoreFrame = null;
      restore();
    });
  } catch {}
  appScrollRestoreTimer = setTimeout(() => {
    appScrollRestoreTimer = null;
    restore();
  }, 0);
}
function schedulePostCommit(fn, timeout = 48){
  let done = false;
  const run = () => {
    if(done) return;
    done = true;
    fn();
  };
  try { requestAnimationFrame(run); } catch {}
  setTimeout(run, timeout);
}
function scheduleRenderPostCommit(token, fn, timeout = 48){
  schedulePostCommit(() => {
    if(token !== renderCommitToken) return;
    fn();
  }, timeout);
}
function renderImmediate(s, opts = {}){
  const renderStartedAt = perfNow();
  const commitToken = ++renderCommitToken;
  analyticsDeferredToken += 1;
  if(typeof cancelAnalyticsDeferredPatches === 'function') cancelAnalyticsDeferredPatches();
  if(typeof cancelScheduledChartBind === 'function') cancelScheduledChartBind();
  perfBucket(viewModeKey());
  rangeFilter = normalizeRangeFilter(rangeFilter);
  snapshot = s;
  sessionTableItems = [];
  if(opts.preserveRefreshState !== true) setRefreshState('');
  const app = document.getElementById('app');
  const requestedScrollTop = Number(opts.preserveScrollTop);
  const previousScrollTop = opts.preserveScroll !== false
    ? (Number.isFinite(requestedScrollTop) ? requestedScrollTop : Number(app?.scrollTop || 0))
    : NaN;
  const modeKey = viewModeKey();
  const modeChanged = lastRenderMode && lastRenderMode !== modeKey;
  lastRenderMode = modeKey;
  syncFooter();
  applyCompactWindowChrome();
  if(modeChanged){
    app?.classList.add('view-switching');
    setAppInteractionMode('view-switching', 170);
  }
  if(!s || !s.ok) return renderError(s);
  const sourceOpts = sourceOptions(s);
  if(sourceFilter !== 'all' && !sourceOpts.some((x) => x[0] === sourceFilter)) sourceFilter = 'all';
  const needsRequestScope = layoutMode === 'compact' || workspaceMode === 'analytics';
  if(needsRequestScope && modelFilter !== 'all' && !modelOptions(s).includes(modelFilter)) modelFilter = 'all';
  if(needsRequestScope && analyticsProjectFilter !== 'all' && !analyticsProjectOptions(s).some((item) => item.key === analyticsProjectFilter)){
    analyticsProjectFilter = 'all';
    localStorage.setItem('statsProject', analyticsProjectFilter);
  }
  const rowsForRender = () => {
    const filterStartedAt = perfNow();
    const list = getFilteredRowsForView(s);
    markPerfStage('filterMs', perfNow() - filterStartedAt);
    return list;
  };
  if(layoutMode === 'compact'){
    const rows = rowsForRender();
    commitAppHtml(app, `${headerHtml(true)}${filtersHtml(s)}${renderCompactMenu(s, rows)}`);
    syncFooter();
    preserveAppScroll(app, previousScrollTop);
    if(opts.windowLayout !== false) applyWindowLayout();
    markRenderCost(renderStartedAt, 'compact', rows.length);
    scheduleRenderPostCommit(commitToken, () => {
      app?.classList.remove('view-switching');
      document.body?.classList?.remove?.('view-switching');
    });
    return;
  }
  if(workspaceMode === 'sessions'){
    markPerfStage('filterMs', 0);
    const domStartedAt = perfNow();
    const patched = opts.partial === true && !modeChanged && patchSessionView(s, opts);
    const deferRows = true;
    if(!patched) commitAppHtml(app, `${headerHtml(false)}${filtersHtml(s)}${renderSessionWorkspace(s, { deferRows })}`);
    markPerfStage('domCommitMs', perfNow() - domStartedAt);
    syncFooter();
    preserveAppScroll(app, previousScrollTop);
    if(opts.windowLayout !== false) applyWindowLayout();
    markRenderCost(renderStartedAt, patched ? 'sessions:partial' : 'sessions', sessionTableItems.length);
    scheduleRenderPostCommit(commitToken, () => {
      app?.classList.remove('view-switching');
      document.body?.classList?.remove?.('view-switching');
      bindIncrementalTables();
      if(deferRows && typeof hydrateSessionRows === 'function') hydrateSessionRows();
    });
    return;
  }
  const deferHeavy = opts.deferHeavy === true;
  const rows = rowsForRender();
  const domStartedAt = perfNow();
  const preserveDatePopover = Boolean(dateRangeOpen && !modeChanged && document.querySelector?.('.date-range-popover'));
  const patched = (opts.partial === true || preserveDatePopover) && !modeChanged && patchAnalyticsView(s, rows, { ...opts, preserveFilters: preserveDatePopover || opts.preserveFilters === true });
  if(!patched) commitAppHtml(app, analyticsShellHtml(s, rows, opts));
  markPerfStage('domCommitMs', perfNow() - domStartedAt);
  syncFooter();
  preserveAppScroll(app, previousScrollTop);
  if(opts.windowLayout !== false) applyWindowLayout();
  markRenderCost(renderStartedAt, patched ? 'analytics:partial' : 'analytics', rows.length);
  const instant = opts.instantChart === true || modeChanged || suppressChartIntro || patched;
  scheduleRenderPostCommit(commitToken, () => {
    app?.classList.remove('view-switching');
    document.body?.classList?.remove?.('view-switching');
    bindIncrementalTables();
    if(deferHeavy && !patched){
      const token = ++analyticsDeferredToken;
      scheduleAnalyticsDeferredPatches(token, rows, s);
    }
    scheduleDashboardAggregates(s, opts);
    const chartDelay = modeChanged ? 64 : (patched ? 180 : 80);
    if(typeof scheduleChartBind === 'function') scheduleChartBind(rows, s, { instant }, chartDelay);
    else {
      bindChart(rows, s, { instant });
      if(typeof ensureChartResizeObserver === 'function') ensureChartResizeObserver();
    }
  });
}

function bindIncrementalTables(){
  if(tableScrollBindFrame) cancelAnimationFrame(tableScrollBindFrame);
  tableScrollBindFrame = requestAnimationFrame(() => {
    tableScrollBindFrame = null;
    const requestScroller = document.querySelector('.request-main .table-scroll');
    if(requestScroller && !requestScroller.dataset.incrementalBound){
      requestScroller.dataset.incrementalBound = '1';
      requestScroller.addEventListener('scroll', () => {
        if(workspaceMode !== 'analytics' || tableTab !== 'requests' || !snapshot?.ok) return;
        if(requestScroller.scrollTop + requestScroller.clientHeight < requestScroller.scrollHeight - 180) return;
        appendRequestRows();
      }, { passive:true });
    }
    const sessionScroller = document.querySelector('.session-scroll');
    if(sessionScroller && !sessionScroller.dataset.incrementalBound){
      sessionScroller.dataset.incrementalBound = 'paged';
    }
  });
}
/* @dashboard-include-list
dashboard/events/date-events.js
dashboard/events/chrome-events.js
dashboard/events/session-events.js
dashboard/events/analytics-events.js
dashboard/events/form-events.js
dashboard/dashboard-events.js
dashboard/events/window-events.js
*/
