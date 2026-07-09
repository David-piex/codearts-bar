const { ipcRenderer } = require('electron');

let snapshot = null;
let copyResetTimer = null;
let autoRefreshTimer = null;
let sourceFilter = localStorage.getItem('statsSource') || 'all';
let modelFilter = localStorage.getItem('statsModel') || 'all';
let rangeFilter = localStorage.getItem('statsRange') || 'today';
let customRangeDays = Math.max(2, Math.min(365, Number(localStorage.getItem('customRangeDays') || '60') || 60));
let customDateStart = Number(localStorage.getItem('customDateStart') || 0) || (Date.now() - 86400000);
let customDateEnd = Number(localStorage.getItem('customDateEnd') || 0) || Date.now();
let dateRangeOpen = false;
let dateRangeDraftStart = 0;
let dateRangeDraftEnd = 0;
let dateRangeFocus = 'start';
let dateRangeMonth = Number(localStorage.getItem('dateRangeMonth') || 0) || 0;
let tableTab = localStorage.getItem('statsTableTab') || 'requests';
let workspaceMode = localStorage.getItem('workspaceMode') || 'analytics';
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
let pinnedSessionKeys = new Set((localStorage.getItem('pinnedSessionKeys') || '').split('|').filter(Boolean));
let renameSessionKey = '';
let renameDraft = '';
let bulkMetaOpen = false;
let bulkMetaTagsDraft = '';
let bulkMetaNoteDraft = '';
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
let queryRenderTimer = null;
let analyticsDeferredToken = 0;
const SESSION_PAGE_SIZE = 48;
let requestTableRenderLimit = 100;
let sessionTableRenderLimit = SESSION_PAGE_SIZE;
let sessionTablePage = Math.max(0, Number(localStorage.getItem('sessionTablePage') || '0') || 0);
let requestPageLoading = false;
let sessionPageLoading = false;
let sessionPageCache = { key: '', items: null, total: 0, page: 0, timestamp: 0 };
let sessionRequestPageCache = new Map();
let sessionRequestPageInflight = new Map();
let sessionPageRefreshTimer = null;
let lastRenderPerf = null;
let currentRenderPerf = null;
let tableScrollBindFrame = null;
let perfPanelOpen = localStorage.getItem('perfPanelOpen') === '1';
let aggregateRefreshToken = 0;
let aggregateRefreshTimer = null;
let renderScheduleFrame = null;
let renderScheduleTimer = null;
let renderScheduled = false;
let pendingRenderState = null;
let pendingRenderOptions = null;
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

function rendererPartPath(name){
  try {
    const src = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
    if(src.startsWith('file://')){
      const u = new URL(src);
      let filePath = decodeURIComponent(u.pathname || '').replace(/^\/([A-Za-z]:)/, '$1');
      return require('node:path').join(require('node:path').dirname(filePath), name);
    }
  } catch {}
  try { return require('node:path').join(__dirname, name); } catch {}
  try { return require('node:path').join('src', name); } catch {}
  return name;
}
function readRendererPart(name){ return require('node:fs').readFileSync(rendererPartPath(name), 'utf8'); }

eval(readRendererPart('dashboard/i18n.js'));
eval(['core/cacheMetrics.js','dashboard-state.js','dashboard-date-range.js','dashboard/analytics/analytics-core.js','dashboard/analytics/analytics-agent-idle.js','dashboard-analytics.js','dashboard/chart/chart-series.js','dashboard/chart/chart-legend.js','dashboard/chart/chart-canvas.js','dashboard/chart/chart-tooltip.js','dashboard/chart/chart-hover.js','dashboard-chart.js','dashboard-sessions.js'].map(readRendererPart).join('\n'));
eval(['dashboard/dashboard-shell.js','dashboard/dashboard-error-state.js','dashboard/dashboard-diagnostics.js','dashboard/dashboard-bootstrap.js'].map(readRendererPart).join('\n'));
let lastCommittedHtml = '';
let lastRenderCost = 0;
eval(readRendererPart('dashboard/dashboard-perf.js'));
eval(['dashboard/dashboard-slots.js','dashboard/slots/slot-core.js','dashboard/slots/analytics-slots.js','dashboard/slots/data-page-slots.js','dashboard/slots/session-slots.js','dashboard/slots/perf-panel-slot.js'].map(readRendererPart).join('\n'));
function mergeRenderOptions(prev = {}, next = {}){
  prev = prev || {};
  next = next || {};
  const merged = { ...prev, ...next };
  if(prev.windowLayout === false || next.windowLayout === false) merged.windowLayout = false;
  if(prev.instantChart || next.instantChart) merged.instantChart = true;
  if(prev.deferHeavy || next.deferHeavy) merged.deferHeavy = true;
  if(prev.partial || next.partial) merged.partial = true;
  if(prev.skipAggregates || next.skipAggregates) merged.skipAggregates = true;
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
function renderImmediate(s, opts = {}){
  const renderStartedAt = perfNow();
  perfBucket(viewModeKey());
  rangeFilter = normalizeRangeFilter(rangeFilter);
  snapshot = s;
  sessionTableItems = [];
  setRefreshState('');
  const app = document.getElementById('app');
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
    if(opts.windowLayout !== false) applyWindowLayout();
    markRenderCost(renderStartedAt, 'compact', rows.length);
    schedulePostCommit(() => {
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
    if(opts.windowLayout !== false) applyWindowLayout();
    markRenderCost(renderStartedAt, patched ? 'sessions:partial' : 'sessions', sessionTableItems.length);
    schedulePostCommit(() => {
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
  const patched = opts.partial === true && !modeChanged && patchAnalyticsView(s, rows, opts);
  if(!patched) commitAppHtml(app, analyticsShellHtml(s, rows, opts));
  markPerfStage('domCommitMs', perfNow() - domStartedAt);
  syncFooter();
  if(opts.windowLayout !== false) applyWindowLayout();
  markRenderCost(renderStartedAt, patched ? 'analytics:partial' : 'analytics', rows.length);
  const instant = opts.instantChart === true || modeChanged || suppressChartIntro || patched;
  schedulePostCommit(() => {
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
eval(['dashboard/events/date-events.js','dashboard/events/chrome-events.js','dashboard/events/session-events.js','dashboard/events/analytics-events.js','dashboard/events/form-events.js','dashboard/dashboard-events.js','dashboard/events/window-events.js'].map(readRendererPart).join('\n'));
