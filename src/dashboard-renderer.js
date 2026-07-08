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
let dateRangeFollowNow = localStorage.getItem('dateRangeFollowNow') !== '0';
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
let sessionAdvancedOpen = localStorage.getItem('sessionAdvancedOpen') === '1';
let selectedRequestKey = localStorage.getItem('selectedRequestKey') || '';
let refreshEvery = localStorage.getItem('statsRefreshEvery') || '30';
let layoutMode = 'dashboard';
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
let sessionTableItems = [];
let lastToastTimer = null;
let lastWindowLayoutApplied = '';
let lastRenderMode = '';
let suppressChartIntro = false;
let resizeFrame = null;
let queryRenderTimer = null;
let analyticsDeferredToken = 0;
let requestTableRenderLimit = 100;
let sessionTableRenderLimit = 80;
let requestPageLoading = false;
let sessionPageLoading = false;
let lastRenderPerf = null;
let currentRenderPerf = null;
let tableScrollBindFrame = null;
let perfPanelOpen = localStorage.getItem('perfPanelOpen') === '1';
let aggregateRefreshToken = 0;
let aggregateRefreshTimer = null;
let visibleSeries = new Set((localStorage.getItem('chartSeries') || 'total,input,output,cacheHitRate').split(',').filter(Boolean));
let sessionMeta = {};
const prefersReducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

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
eval(['dashboard-state.js','dashboard-date-range.js','dashboard/analytics/analytics-core.js','dashboard/analytics/analytics-agent-idle.js','dashboard-analytics.js','dashboard/chart/chart-series.js','dashboard/chart/chart-legend.js','dashboard/chart/chart-canvas.js','dashboard/chart/chart-tooltip.js','dashboard/chart/chart-hover.js','dashboard-chart.js','dashboard-sessions.js'].map(readRendererPart).join('\n'));
eval(['dashboard/dashboard-shell.js','dashboard/dashboard-error-state.js','dashboard/dashboard-bootstrap.js'].map(readRendererPart).join('\n'));
let lastCommittedHtml = '';
let lastRenderCost = 0;
eval(readRendererPart('dashboard/dashboard-perf.js'));
eval(readRendererPart('dashboard/dashboard-slots.js'));
function render(s, opts = {}){
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
  if(opts.windowLayout !== false) applyWindowLayout();
  if(modeChanged) app?.classList.add('view-switching');
  if(!s || !s.ok) return renderError(s);
  const sourceOpts = sourceOptions(s);
  if(sourceFilter !== 'all' && !sourceOpts.some((x) => x[0] === sourceFilter)) sourceFilter = 'all';
  if(modelFilter !== 'all' && !modelOptions(s).includes(modelFilter)) modelFilter = 'all';
  const filterStartedAt = perfNow();
  const rows = filterRows(s);
  markPerfStage('filterMs', perfNow() - filterStartedAt);
  if(layoutMode === 'compact'){
    commitAppHtml(app, `${headerHtml(true)}${filtersHtml(s)}${renderCompactMenu(s, rows)}`);
    syncFooter();
    if(opts.windowLayout !== false) applyWindowLayout();
    markRenderCost(renderStartedAt, 'compact', rows.length);
    requestAnimationFrame(() => app?.classList.remove('view-switching'));
    return;
  }
  if(workspaceMode === 'sessions'){
    const domStartedAt = perfNow();
    const patched = opts.partial === true && !modeChanged && patchSessionView(s, opts);
    if(!patched) commitAppHtml(app, `${headerHtml(false)}${filtersHtml(s)}${renderSessionWorkspace(s)}`);
    markPerfStage('domCommitMs', perfNow() - domStartedAt);
    syncFooter();
    markRenderCost(renderStartedAt, patched ? 'sessions:partial' : 'sessions', sessionTableItems.length);
    requestAnimationFrame(() => { app?.classList.remove('view-switching'); bindIncrementalTables(); });
    return;
  }
  const deferHeavy = opts.deferHeavy === true;
  const domStartedAt = perfNow();
  const patched = opts.partial === true && !modeChanged && patchAnalyticsView(s, rows, opts);
  if(!patched) commitAppHtml(app, analyticsShellHtml(s, rows, opts));
  markPerfStage('domCommitMs', perfNow() - domStartedAt);
  syncFooter();
  const instant = opts.instantChart === true || modeChanged || suppressChartIntro || patched;
  requestAnimationFrame(() => {
    bindChart(rows, s, { instant });
    app?.classList.remove('view-switching');
    markRenderCost(renderStartedAt, patched ? 'analytics:partial' : 'analytics', rows.length);
    bindIncrementalTables();
    if(deferHeavy && !patched){
      const token = ++analyticsDeferredToken;
      setTimeout(() => {
        if(token !== analyticsDeferredToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
        patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
        patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
        bindIncrementalTables();
      }, 35);
    }
    scheduleDashboardAggregates(s, opts);
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
      sessionScroller.dataset.incrementalBound = '1';
      sessionScroller.addEventListener('scroll', () => {
        if(workspaceMode !== 'sessions' || !snapshot?.ok) return;
        if(sessionScroller.scrollTop + sessionScroller.clientHeight < sessionScroller.scrollHeight - 180) return;
        appendSessionRows();
      }, { passive:true });
    }
  });
}
eval(['dashboard/events/date-events.js','dashboard/dashboard-events.js','dashboard/events/window-events.js'].map(readRendererPart).join('\n'));
