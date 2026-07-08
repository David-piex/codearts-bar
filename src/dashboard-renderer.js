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
let sessionTableItems = [];
let lastToastTimer = null;
let lastWindowLayoutApplied = '';
let lastRenderMode = '';
let suppressChartIntro = false;
let resizeFrame = null;
let queryRenderTimer = null;
let analyticsDeferredToken = 0;
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

const fmt = new Intl.NumberFormat('zh-CN');
const COLORS = {
  input: '#2f7df6',
  output: '#16b862',
  cacheWrite: '#f97316',
  cacheRead: '#9b57ff',
  total: '#f43f5e',
  queue: '#7c3aed',
  wait: '#0ea5e9',
  purple: '#7c3aed',
  green: '#08a045',
  red: '#ef3b55',
  muted: '#64748b',
};
const TXT = {
  noData: '\u65e0\u6570\u636e',
  all: '\u5168\u90e8',
  desktop: '\u684c\u9762\u7aef',
  cli: 'CLI',
  unknown: '\u672a\u77e5',
  settings: '\u8bbe\u7f6e',
  usage: '\u4f7f\u7528\u7edf\u8ba1',
  analyticsWorkspace: '\u4f7f\u7528\u5206\u6790',
  sessionWorkspace: '\u4f1a\u8bdd\u7ba1\u7406\u5668',
  analyticsWorkspaceHint: '\u8d8b\u52bf\u3001\u6027\u80fd\u3001\u7f13\u5b58\u547d\u4e2d\u7387\u548c\u6765\u6e90\u62c6\u5206',
  sessionWorkspaceHint: '\u67e5\u627e\u3001\u56fa\u5b9a\u3001\u4fdd\u5b58\u3001\u6253\u5f00\u548c\u5f52\u6863\u4f1a\u8bdd',
  desc: '\u67e5\u770b\u7801\u9053 AI \u6a21\u578b\u7684 token\u3001\u6027\u80fd\u3001\u6392\u961f\u548c\u4f1a\u8bdd\u6570\u636e',
  subtitle: '\u7801\u9053 Bar \u00b7 CLI / \u684c\u9762\u7aef usage dashboard',
  realTokens: '\u771f\u5b9e\u6d88\u8017 token',
  selectedRange: '\u5f53\u524d\u7b5b\u9009',
  todayToken: '\u4eca\u65e5 token',
  windowToken: '24h token',
  weekToken: '7d token',
  allToken: '\u5386\u53f2 token',
  input: '\u8f93\u5165',
  output: '\u8f93\u51fa',
  cacheWrite: '\u7f13\u5b58\u521b\u5efa',
  cacheRead: '\u7f13\u5b58\u547d\u4e2d',
  cacheHitRate: '\u7f13\u5b58\u547d\u4e2d\u7387',
  cacheHitBasis: '\u547d\u4e2d / \u53ef\u590d\u7528\u63d0\u793a\u8bcd',
  cacheEfficiency: '\u7f13\u5b58\u6548\u7387',
  cacheReuse: '\u590d\u7528\u500d\u6570',
  cacheCoverage: '\u8f93\u5165\u8986\u76d6',
  cacheBreakdown: '\u7f13\u5b58\u7ec6\u5206',
  cacheTotal: '\u7f13\u5b58\u603b\u91cf',
  cacheSavedHint: '\u547d\u4e2d\u8d8a\u9ad8\uff0c\u6a21\u578b\u4e0a\u4e0b\u6587\u590d\u7528\u8d8a\u5145\u5206',
  cacheHealth: '\u7f13\u5b58\u4f53\u611f',
  cacheLowHint: '\u547d\u4e2d\u504f\u4f4e\uff0c\u53ef\u80fd\u662f\u65b0\u4e0a\u4e0b\u6587\u6216\u9891\u7e41\u5207\u6362\u4efb\u52a1',
  cacheMidHint: '\u5df2\u6709\u590d\u7528\uff0c\u7ee7\u7eed\u4fdd\u6301\u8fde\u7eed\u4f1a\u8bdd\u53ef\u63d0\u5347\u547d\u4e2d',
  cacheHighHint: '\u590d\u7528\u826f\u597d\uff0c\u8f93\u5165\u4e0a\u4e0b\u6587\u6b63\u5728\u6709\u6548\u88ab\u547d\u4e2d',
  requests: '\u8bf7\u6c42',
  queue: '\u6392\u961f\u65f6\u95f4',
  trend: '\u4f7f\u7528\u8d8b\u52bf',
  reqLog: '\u8bf7\u6c42\u65e5\u5fd7',
  providerStats: 'Provider \u7edf\u8ba1',
  modelStats: '\u6a21\u578b\u7edf\u8ba1',
  sessionManage: '\u4f1a\u8bdd\u7ba1\u7406',
  source: '\u6765\u6e90',
  model: '\u6a21\u578b',
  provider: '\u4f9b\u5e94\u5546',
  time: '\u65f6\u95f4',
  total: '\u603b token',
  status: '\u72b6\u6001',
  session: '\u4f1a\u8bdd',
  wait: '\u603b\u7b49\u5f85',
  firstContent: '\u7b49\u5f85\u9996\u5185\u5bb9',
  speed: '\u8f93\u51fa\u901f\u5ea6',
  ttft: 'TTFT',
  search: '\u641c\u7d22\u4f1a\u8bdd / provider / model',
  sessionSearch: '\u641c\u7d22\u4f1a\u8bdd / \u9879\u76ee / \u6807\u7b7e',
  refreshed: '\u5df2\u5237\u65b0',
  refresh: '\u5237\u65b0\u4e2d...',
  realtime: '\u5b9e\u65f6\u66f4\u65b0',
  copy: '\u590d\u5236',
  copied: '\u5df2\u590d\u5236',
  allSource: '\u5168\u90e8\u6765\u6e90',
  allModel: '\u5168\u90e8\u6a21\u578b',
  today: '\u5f53\u5929',
  failed: '\u8bfb\u53d6\u5931\u8d25',
  general: '\u901a\u7528',
  route: '\u8def\u7531',
  auth: '\u8ba4\u8bc1',
  advanced: '\u9ad8\u7ea7',
  rows: '\u884c',
  sourceOverview: '\u6765\u6e90\u6982\u89c8',
  active: '\u6fc0\u6d3b',
  archived: '\u5df2\u5f52\u6863',
  open: '\u6253\u5f00',
  archive: '\u5f52\u6863',
  restore: '\u6062\u590d',
  directory: '\u76ee\u5f55',
  turns: '\u8f6e\u6b21',
  calls: '\u8c03\u7528',
  updated: '\u66f4\u65b0',
  autoRefresh: '\u81ea\u52a8\u5237\u65b0',
  chartSeries: '\u56fe\u8868\u6307\u6807',
  chartSnapshot: '\u6307\u6807\u6458\u8981',
  chartSnapshotHint: '\u70b9\u51fb\u6307\u6807\u5361\u7247\u53ef\u663e\u793a / \u9690\u85cf\u5bf9\u5e94\u66f2\u7ebf',
  chartPeak: '\u5cf0\u503c',
  chartAvg: '\u5747\u503c',
  chartSum: '\u603b\u91cf',
  currentFilter: '\u5f53\u524d\u6761\u4ef6',
  sessionStatus: '\u4f1a\u8bdd\u72b6\u6001',
  allSessions: '\u5168\u90e8\u4f1a\u8bdd',
  activeSessions: '\u6fc0\u6d3b\u4f1a\u8bdd',
  archivedSessions: '\u5df2\u5f52\u6863',
  selectedSession: '\u4f1a\u8bdd\u8be6\u60c5',
  noSessionSelected: '\u9009\u4e2d\u4e00\u4e2a\u4f1a\u8bdd\u67e5\u770b\u8be6\u60c5',
  tokenBreakdown: 'token \u62c6\u5206',
  topModel: '\u4e3b\u8981\u6a21\u578b',
  copyId: '\u590d\u5236 ID',
  copyPath: '\u590d\u5236\u8def\u5f84',
  rename: '\u91cd\u547d\u540d',
  copySummary: '\u590d\u5236\u6458\u8981',
  requestDetails: '\u8bf7\u6c42\u660e\u7ec6',
  noRequests: '\u6682\u65e0\u8bf7\u6c42\u8bb0\u5f55',
  sort: '\u6392\u5e8f',
  byUpdated: '\u6700\u8fd1\u66f4\u65b0',
  byToken: 'token \u6700\u591a',
  byTurns: '\u8f6e\u6b21\u6700\u591a',
  byCache: '\u7f13\u5b58\u547d\u4e2d\u6700\u9ad8',
  byOpportunity: '\u4f18\u5316\u4f18\u5148\u7ea7',
  details: '\u8be6\u60c5',
  actionDone: '\u64cd\u4f5c\u5df2\u5b8c\u6210',
  pin: '\u7f6e\u9876',
  unpin: '\u53d6\u6d88\u7f6e\u9876',
  selected: '\u5df2\u9009',
  selectAll: '\u5168\u9009',
  clearSelection: '\u6e05\u7a7a',
  copySelected: '\u590d\u5236\u6458\u8981',
  exportJson: '\u590d\u5236 JSON',
  exportCsv: '\u590d\u5236 CSV',
  archiveSelected: '\u6279\u91cf\u5f52\u6863',
  restoreSelected: '\u6279\u91cf\u6062\u590d',
  save: '\u4fdd\u5b58',
  cancel: '\u53d6\u6d88',
  renameTitle: '\u91cd\u547d\u540d\u4f1a\u8bdd',
  renameHint: '\u8f93\u5165\u65b0\u7684\u4f1a\u8bdd\u540d\u79f0',
  sessionJson: '\u4f1a\u8bdd JSON',
  pinned: '\u5df2\u7f6e\u9876',
  emptyHint: '\u6682\u65e0\u5339\u914d\u6570\u636e',
  allDims: '\u5168\u90e8\u7ef4\u5ea6',
  sourceHint: '\u6309 CLI / \u684c\u9762\u7aef\u62c6\u5206\uff0c\u70b9\u51fb\u5361\u7247\u6216\u9876\u90e8\u6309\u94ae\u76f4\u63a5\u7b5b\u9009',
  dateRange: '\u65e5\u671f\u8303\u56f4',
  supportDateTime: '\u652f\u6301\u65e5\u671f\u4e0e\u65f6\u95f4',
  startTime: '\u5f00\u59cb\u65f6\u95f4',
  endTime: '\u7ed3\u675f\u65f6\u95f4',
  followNow: '\u7ed3\u675f\u65f6\u95f4\u8ddf\u968f\u5f53\u524d\u65f6\u523b',
  confirm: '\u786e\u5b9a',
  previousMonth: '\u4e0a\u4e2a\u6708',
  nextMonth: '\u4e0b\u4e2a\u6708',
  viewRequests: '\u67e5\u770b\u8bf7\u6c42',
  modelBreakdown: '\u6a21\u578b\u62c6\u5206',
  hoverHint: '\u79fb\u5230\u56fe\u8868\u4e0a\u67e5\u770b\u6570\u503c\uff0c\u70b9\u51fb\u53ef\u56fa\u5b9a',
  requestTimeline: '\u8bf7\u6c42\u65f6\u95f4\u7ebf',
  copyMarkdown: '\u590d\u5236 Markdown',
  copyRequestJson: '\u590d\u5236\u8bf7\u6c42 JSON',
  exportMarkdown: '\u590d\u5236 Markdown',
  sourceCompare: 'CLI / \u684c\u9762\u7aef',
  sourceCompareHint: '\u6309\u6765\u6e90\u62c6\u5206 token\u3001\u8bf7\u6c42\u3001TTFT \u548c\u7b49\u5f85',
  rangeToken: '\u533a\u95f4 token',
  liveAfterReply: '\u5bf9\u8bdd\u7ed3\u675f\u540e\u81ea\u52a8\u5237\u65b0',
  notesTags: '\u5907\u6ce8\u4e0e\u6807\u7b7e',
  tagsPlaceholder: '\u6807\u7b7e\uff0c\u7528\u9017\u53f7\u5206\u9694',
  notePlaceholder: '\u4e3a\u8fd9\u4e2a\u4f1a\u8bdd\u8bb0\u4e00\u53e5\u5907\u6ce8',
  savedLocal: '\u5df2\u672c\u5730\u4fdd\u5b58',
  openCodeArts: '\u7528\u7801\u9053\u6253\u5f00',
  bulkTag: '\u6279\u91cf\u6807\u8bb0',
  bulkMetaTitle: '\u6279\u91cf\u6807\u8bb0\u4f1a\u8bdd',
  bulkMetaHint: '\u6807\u7b7e\u4f1a\u5408\u5e76\uff0c\u5907\u6ce8\u4f1a\u8ffd\u52a0\u5230\u9009\u4e2d\u4f1a\u8bdd',
  apply: '\u5e94\u7528',
  requestInspector: '\u8bf7\u6c42\u8be6\u60c5',
  tokenInputOutput: 'token \u8f93\u5165 / \u8f93\u51fa',
  copyRequest: '\u590d\u5236\u8bf7\u6c42',
  viewSession: '\u67e5\u770b\u4f1a\u8bdd',
  pinPoint: '\u70b9\u51fb\u6216 Enter \u56fa\u5b9a\u70b9\u4f4d\uff0c\u65b9\u5411\u952e\u5207\u6362',
  chartLegend: '\u56fe\u8868\u56fe\u4f8b',
  idleBand: '\u7a7a\u95f2\u80cc\u666f\u5e26',
  activeBand: '\u6d3b\u8dc3\u65f6\u6bb5',
  pinnedPoint: '\u5df2\u56fa\u5b9a\u70b9\u4f4d',
  unpinPoint: '\u53cc\u51fb\u53d6\u6d88\u56fa\u5b9a',
  cacheCreateShort: '\u521b\u5efa',
  cacheReadShort: '\u547d\u4e2d',
  menuCardMode: '\u83dc\u5355\u5361\u7247',
  dashboardMode: '\u4eea\u8868\u76d8',
  compactTitle: '\u7801\u9053\u7528\u91cf',
  compactHint: '\u7d27\u51d1 CodexBar \u98ce\u683c\u3002\u6253\u5f00\u5373\u770b token\u3001TTFT\u3001\u7b49\u5f85\u548c\u4f1a\u8bdd\u3002',
  recentSessions: '\u6700\u8fd1\u4f1a\u8bdd',
  peakHour: '\u5cf0\u503c\u5c0f\u65f6',
  idleHours: 'Agent \u7a7a\u95f2',
  idleWindow: 'Agent \u7a7a\u95f2',
  idleNow: '\u5f53\u524d\u7a7a\u95f2',
  noIdle: '24h \u5185\u65e0\u5b8c\u6574\u7a7a\u95f2\u5c0f\u65f6',
  idleHint: '\u6309\u5f53\u524d\u6765\u6e90 / \u6a21\u578b\u7b5b\u9009\u8ba1\u7b97\uff0c\u65e0\u8bf7\u6c42\u7684\u5c0f\u65f6\u89c6\u4e3a\u7a7a\u95f2',
  agentRhythm: 'Agent \u7a7a\u95f2',
  agentRhythmHint: '24 \u5c0f\u65f6\u7a7a\u95f2 / \u5fd9\u788c\u7a97\u53e3\uff0c\u7528\u4e8e\u5b89\u6392\u4efb\u52a1\u548c\u89c2\u5bdf\u6210\u672c',
  activeTotal: '\u5fd9\u788c\u65f6\u957f',
  idleTotal: '\u7a7a\u95f2\u603b\u65f6\u957f',
  activeRatio: '\u6d3b\u8dc3\u5360\u6bd4',
  recommendedWindow: '\u63a8\u8350\u7a97\u53e3',
  longestIdle: '\u6700\u957f\u7a7a\u95f2',
  busyWindows: '\u9ad8\u5cf0\u65f6\u6bb5',
  idleWindows: '\u7a7a\u95f2\u7a97\u53e3',
  rhythmNowBusy: '\u5f53\u524d\u6b63\u5728\u5904\u7406\u8bf7\u6c42',
  rhythmNowIdle: '\u5f53\u524d\u5904\u4e8e\u7a7a\u95f2\u7a97\u53e3',
  noBusy: '24h \u5185\u6682\u65e0\u5fd9\u788c\u5c0f\u65f6',
  activeHour: '\u5fd9\u788c',
  avg: '\u5747\u503c',
  tagFilter: '\u6807\u7b7e',
  quickView: '\u5feb\u901f\u89c6\u56fe',
  filterContext: '\u7b5b\u9009\u4e0a\u4e0b\u6587',
  resetFilters: '\u91cd\u7f6e\u7b5b\u9009',
  searchKeyword: '\u641c\u7d22',
  viewAll: '\u5168\u90e8\u89c6\u56fe',
  pinnedOnly: '\u53ea\u770b\u7f6e\u9876',
  taggedOnly: '\u6709\u6807\u7b7e / \u5907\u6ce8',
  cacheHigh: '\u9ad8\u547d\u4e2d',
  cacheOpportunities: '\u7f13\u5b58\u4f18\u5316\u673a\u4f1a',
  cacheOpportunityHint: '\u9ad8 token \u4f46\u4f4e\u547d\u4e2d\u7684\u4f1a\u8bdd\uff0c\u4f18\u5148\u68c0\u67e5\u662f\u5426\u9891\u7e41\u5207\u6362\u4e0a\u4e0b\u6587',
  cacheInsights: '\u7f13\u5b58\u547d\u4e2d\u4e2d\u5fc3',
  cacheInsightsHint: '\u6309\u6a21\u578b\u3001\u9879\u76ee\u548c\u6765\u6e90\u627e\u51fa\u53ef\u63d0\u5347\u547d\u4e2d\u7387\u7684\u9ad8\u6d88\u8017\u533a\u57df',
  cacheOpportunityScore: '\u4f18\u5316\u4f18\u5148\u7ea7',
  cacheInsightModel: '\u6a21\u578b\u7ef4\u5ea6',
  cacheInsightProject: '\u9879\u76ee\u7ef4\u5ea6',
  cacheInsightSource: '\u6765\u6e90\u7ef4\u5ea6',
  cacheWastedTokens: '\u53ef\u63d0\u5347 token',
  cacheActionLow: '\u5efa\u8bae\u5408\u5e76\u540c\u4e00\u4efb\u52a1\u7684\u8fde\u7eed\u5bf9\u8bdd\uff0c\u51cf\u5c11\u91cd\u65b0\u5efa\u7acb\u4e0a\u4e0b\u6587',
  cacheActionMid: '\u5df2\u6709\u590d\u7528\uff0c\u53ef\u4f18\u5148\u7eed\u7528\u70ed\u4f1a\u8bdd\u548c\u56fa\u5b9a\u9879\u76ee\u80cc\u666f',
  cacheActionHigh: '\u590d\u7528\u5065\u5eb7\uff0c\u9002\u5408\u4f5c\u4e3a\u957f\u7ebf\u4efb\u52a1\u6216\u56fa\u5b9a\u5de5\u4f5c\u53f0',
  cacheActionNone: '\u6682\u65e0\u660e\u663e\u7f13\u5b58\u4f18\u5316\u7a7a\u95f4',
  cacheGovernance: '\u7f13\u5b58\u6cbb\u7406\u5de5\u4f5c\u53f0',
  cacheGovernanceHint: '\u5c06\u4f4e\u547d\u4e2d\u4f1a\u8bdd\u8f6c\u6210\u53ef\u6267\u884c\u6cbb\u7406\u6e05\u5355\uff0c\u4fbf\u4e8e\u5546\u7528\u7248\u8ffd\u8e2a\u6210\u672c\u4e0e\u590d\u7528',
  cacheGovernanceReport: '\u590d\u5236\u6cbb\u7406\u62a5\u544a',
  cacheGovernanceFocus: '\u8fdb\u5165\u4f4e\u547d\u4e2d\u89c6\u56fe',
  cacheGovernanceTop: '\u9996\u8981\u5904\u7406',
  cacheGovernancePotential: '\u53ef\u6539\u5584\u6d88\u8017',
  cacheGovernanceWeighted: '\u52a0\u6743\u547d\u4e2d',
  cacheGovernanceCandidates: '\u5019\u9009\u4f1a\u8bdd',
  cacheGovernanceEmpty: '\u5f53\u524d\u7b5b\u9009\u4e0b\u6ca1\u6709\u660e\u663e\u4f4e\u547d\u4e2d\u9ad8\u6d88\u8017\u4f1a\u8bdd',
  cacheGovernanceCopied: '\u5df2\u590d\u5236\u7f13\u5b58\u6cbb\u7406\u62a5\u544a',
  cacheGovernanceReason: '\u539f\u56e0',
  cacheLow: '\u4f4e\u547d\u4e2d',
  smartViews: '\u667a\u80fd\u89c6\u56fe',
  smartViewsHint: '\u4e00\u952e\u5207\u6362\u5546\u7528\u7ea7\u4f1a\u8bdd\u7ba1\u7406\u573a\u666f',
  smartViewCacheWaste: '\u4f4e\u547d\u4e2d\u9ad8\u6d88\u8017',
  smartViewPinned: '\u7f6e\u9876\u5de5\u4f5c\u53f0',
  smartViewRecent: '\u6700\u8fd1\u6d3b\u8dc3',
  smartViewTriage: '\u5f85\u6574\u7406',
  smartViewArchive: '\u5f52\u6863\u5e93',
  smartViewCacheWasteHint: '\u4f18\u5148\u5904\u7406 token \u9ad8\u4f46\u590d\u7528\u5dee\u7684\u4f1a\u8bdd',
  smartViewPinnedHint: '\u4fdd\u7559\u957f\u7ebf\u4efb\u52a1\u548c\u91cd\u8981\u9879\u76ee',
  smartViewRecentHint: '\u8ffd\u8e2a\u8fd1 7d \u6b63\u5728\u63a8\u8fdb\u7684\u4f1a\u8bdd',
  smartViewTriageHint: '\u65e0\u6807\u7b7e\u65e0\u5907\u6ce8\uff0c\u9700\u8981\u5f52\u7c7b',
  smartViewArchiveHint: '\u67e5\u770b\u5df2\u5b8c\u6210\u6216\u6697\u85cf\u7684\u4f1a\u8bdd',
  savedViews: '\u4fdd\u5b58\u89c6\u56fe',
  savedViewsHint: '\u5c06\u5f53\u524d\u7b5b\u9009\u3001\u9879\u76ee\u3001\u6807\u7b7e\u3001\u6392\u5e8f\u548c\u641c\u7d22\u4fdd\u5b58\u4e3a\u81ea\u5b9a\u4e49\u4f1a\u8bdd\u89c6\u56fe',
  saveCurrentView: '\u4fdd\u5b58\u5f53\u524d\u89c6\u56fe',
  savedViewName: '\u89c6\u56fe\u540d\u79f0',
  savedViewNamePlaceholder: '\u4f8b\u5982\uff1a\u5ba2\u6237\u9879\u76ee / \u4f4e\u547d\u4e2d\u6392\u67e5',
  applyView: '\u5e94\u7528\u89c6\u56fe',
  deleteView: '\u5220\u9664\u89c6\u56fe',
  noSavedViews: '\u5c1a\u672a\u4fdd\u5b58\u81ea\u5b9a\u4e49\u89c6\u56fe',
  savedViewApplied: '\u5df2\u5e94\u7528\u89c6\u56fe',
  savedViewDeleted: '\u5df2\u5220\u9664\u89c6\u56fe',
  recentActiveView: '\u8fd1 7d \u6d3b\u8dc3',
  project: '\u9879\u76ee',
  allProjects: '\u5168\u90e8\u9879\u76ee',
  noProject: '\u672a\u8bc6\u522b\u9879\u76ee',
  projectView: '\u9879\u76ee\u89c6\u56fe',
  allTags: '\u5168\u90e8\u6807\u7b7e',
  noTags: '\u65e0\u6807\u7b7e',
  taggedSessions: '\u5df2\u6807\u8bb0',
  pinnedSessions: '\u7f6e\u9876\u4f1a\u8bdd',
  visibleSessions: '\u5f53\u524d\u5217\u8868',
  sessionEssentials: '\u4f1a\u8bdd\u89c6\u56fe',
  sessionEssentialsHint: '\u53ea\u4fdd\u7559\u4f1a\u8bdd\u672c\u8eab\uff1a\u67e5\u627e\u3001\u7b5b\u9009\u3001\u56fa\u5b9a\u3001\u4fdd\u5b58\u548c\u5f52\u6863',
  advancedManagement: '\u9ad8\u7ea7\u7ba1\u7406',
  showAdvanced: '\u5c55\u5f00\u9ad8\u7ea7',
  hideAdvanced: '\u6536\u8d77\u9ad8\u7ea7',
  advancedManagementHint: '\u72b6\u6001\u3001\u9879\u76ee\u3001\u6807\u7b7e\u3001\u6392\u5e8f\u548c\u6279\u91cf\u64cd\u4f5c\u6536\u5728\u8fd9\u91cc',
  advancedAnalytics: '\u9ad8\u7ea7\u5206\u6790',
  advancedAnalyticsHint: '\u6765\u6e90\u62c6\u5206\u3001\u7f13\u5b58\u6d1e\u5bdf\u3001\u6027\u80fd\u7ec6\u8282\u6536\u5728\u8fd9\u91cc\uff0c\u9ed8\u8ba4\u4e0d\u6253\u6270\u4e3b\u4eea\u8868\u76d8',
  quickArchive: '\u5df2\u5f52\u6863',
  savedViewsMini: '\u5df2\u4fdd\u5b58',
  relativeScale: '\u76f8\u5bf9\u5c3a\u5ea6',
  mixedScaleHint: 'token / ms \u6df7\u5408\u65f6\u6309\u5404\u6307\u6807\u81ea\u8eab\u5cf0\u503c\u7f29\u653e\uff0ctooltip \u663e\u793a\u771f\u5b9e\u6570\u503c',
  eachPeak100: '\u5404\u7ebf\u5cf0\u503c=100%',
  cacheHeatline: '\u7f13\u5b58\u70ed\u5ea6',
  sessionLibraryHint: '\u4f1a\u8bdd\u5e93',
  sessionIdleBrief: 'Agent \u7a7a\u95f2'
};
const RANGE_LABELS = { today: TXT.today, '1d': '1d', '3d': '3d', '7d': '7d', '14d': '14d', '30d': '30d', '60d': '60d', '90d': '90d', '180d': '180d', '365d': '365d', custom: '\u81ea\u5b9a\u4e49', all: '\u5168\u90e8' };
const RANGE_OPTIONS = [['today', TXT.today], ['1d', '1d'], ['3d', '3d'], ['7d', '7d'], ['14d', '14d'], ['30d', '30d'], ['60d', '60d'], ['90d', '90d'], ['180d', '180d'], ['365d', '365d'], ['all', '\u5168\u90e8']];
eval(['dashboard-state.js','dashboard-date-range.js','dashboard-analytics.js','dashboard-chart.js','dashboard-sessions.js'].map(readRendererPart).join('\n'));
function renderError(s){
  const message = esc(s?.error || TXT.noData);
  const app = document.getElementById('app');
  commitAppHtml(app, `${headerHtml(false)}<section class="dashboard-empty-state dashboard-error-state"><div><b>${TXT.failed}</b><span>${message}</span><em>\u65e5\u5fd7\u4f1a\u5199\u5165\u672c\u5730\u8bca\u65ad\u6587\u4ef6\uff0c\u70b9\u51fb\u5237\u65b0\u53ef\u91cd\u8bd5\u3002</em></div><button data-refresh="1">${TXT.refresh}</button><button data-settings="1">${TXT.settings}</button></section>`);
}
function workspaceTabsHtml(){ const tabs = [['analytics', TXT.analyticsWorkspace], ['sessions', TXT.sessionWorkspace]]; return `<div class="tabs workspace-tabs">${tabs.map(([k, label]) => `<button data-workspace="${k}" class="tab ${workspaceMode === k ? 'active' : ''}">${esc(label)}</button>`).join('')}</div>`; }
function headerHtml(compact = false){ const title = compact ? TXT.compactTitle : (workspaceMode === 'sessions' ? TXT.sessionWorkspace : TXT.analyticsWorkspace); const sub = compact ? TXT.compactHint : (workspaceMode === 'sessions' ? TXT.sessionWorkspaceHint : TXT.analyticsWorkspaceHint); return `<div class="topbar ${compact ? 'compact-topbar' : ''}"><div class="back">&#8592;</div><div class="logo"><img src="../assets/codearts-logo.png" /></div><div class="topbar-title"><h1 class="page-title">${title}</h1><div class="page-subtitle">${sub}</div></div><div class="topbar-actions view-mode-switch" role="group" aria-label="\u89c6\u56fe\u6a21\u5f0f"><button data-layout-mode="dashboard" class="${layoutMode === 'dashboard' ? 'active' : ''}" aria-pressed="${layoutMode === 'dashboard' ? 'true' : 'false'}">${TXT.dashboardMode}</button><button data-layout-mode="compact" class="${layoutMode === 'compact' ? 'active' : ''}" aria-pressed="${layoutMode === 'compact' ? 'true' : 'false'}">${TXT.menuCardMode}</button></div></div>${compact ? '' : workspaceTabsHtml()}`; }
function filterControlsHtml(s){ return `${sourceChips(s)}${sourceSelectHtml(s)}${selectHtml('model', modelFilter, modelOptions(s).map((m) => [m, shortModel(m)]), TXT.allModel)}${refreshSelectHtml()}${rangeHtml()}`; }
function sessionFilterControlsHtml(s){ return `${sourceChips(s)}${sourceSelectHtml(s)}${refreshSelectHtml()}`; }
function filtersHtml(s){ if(layoutMode === 'compact') return ''; if(workspaceMode === 'sessions') return `<div class="page-head session-page-head session-filter-head"><div class="filters">${sessionFilterControlsHtml(s)}</div></div>`; return `<div class="page-head"><div class="head-title"><h2>${TXT.analyticsWorkspace}</h2><p>${TXT.desc}</p></div><div class="filters">${filterControlsHtml(s)}</div></div>`; }
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
  if(snapshot?.ok) render(snapshot, renderOptions);
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

let lastCommittedHtml = '';
let lastRenderCost = 0;
function perfNow(){ try { return performance.now(); } catch { return Date.now(); } }
function commitAppHtml(app, html){
  if(lastCommittedHtml === html && app.innerHTML === html) return false;
  lastCommittedHtml = html;
  app.innerHTML = html;
  return true;
}
function markRenderCost(start, label, rows = 0){
  lastRenderCost = Math.round(perfNow() - start);
  try { document.body?.style?.setProperty?.('--last-render-ms', `${lastRenderCost}ms`); } catch {}
  if(lastRenderCost > 180){
    console.debug(`[dashboard] ${label} render ${lastRenderCost}ms rows=${rows}`);
    try { ipcRenderer.invoke('dashboard:log', { level: 'debug', scope: 'renderer', message: `${label} render ${lastRenderCost}ms rows=${rows}` }); } catch {}
  }
}
function analyticsEmptyState(rows){
  if(rows.length) return '';
  return `<section class="dashboard-empty-state analytics-empty-state"><div><b>${TXT.emptyAnalyticsTitle}</b><span>${TXT.emptyAnalyticsHint}</span></div><button data-date-range-toggle="1">${TXT.dateRange}</button><button data-source="all">${TXT.allSource}</button></section>`;
}

function render(s, opts = {}){
  const renderStartedAt = perfNow();
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
  const rows = filterRows(s);
  if(layoutMode === 'compact'){
    commitAppHtml(app, `${headerHtml(true)}${filtersHtml(s)}${renderCompactMenu(s, rows)}`);
    syncFooter();
    if(opts.windowLayout !== false) applyWindowLayout();
    markRenderCost(renderStartedAt, 'compact', rows.length);
    requestAnimationFrame(() => app?.classList.remove('view-switching'));
    return;
  }
  if(workspaceMode === 'sessions'){
    commitAppHtml(app, `${headerHtml(false)}${filtersHtml(s)}${renderSessionWorkspace(s)}`);
    syncFooter();
    markRenderCost(renderStartedAt, 'sessions', sessionTableItems.length);
    requestAnimationFrame(() => app?.classList.remove('view-switching'));
    return;
  }
  const deferHeavy = opts.deferHeavy === true;
  const renderLower = () => `${renderAgentRhythm(s)}${renderTable(rows, s)}${renderAnalyticsAdvanced(rows, s)}`;
  const token = ++analyticsDeferredToken;
  commitAppHtml(app, `${headerHtml(false)}${filtersHtml(s)}${renderSummary(rows, s)}${analyticsEmptyState(rows)}${renderChart(rows, s)}${deferHeavy ? '<div id="analyticsDeferred" class="analytics-deferred"><span>\u6b63\u5728\u66f4\u65b0\u660e\u7ec6...</span></div>' : renderLower()}`);
  syncFooter();
  const instant = opts.instantChart === true || modeChanged || suppressChartIntro;
  requestAnimationFrame(() => {
    bindChart(rows, s, { instant });
    app?.classList.remove('view-switching');
    markRenderCost(renderStartedAt, 'analytics', rows.length);
    if(deferHeavy){
      setTimeout(() => {
        if(token !== analyticsDeferredToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
        const holder = document.getElementById('analyticsDeferred');
        if(holder) holder.outerHTML = renderLower();
      }, 35);
    }
  });
}
function setRefreshState(text){ const el = document.getElementById('refreshState'); if(el) el.textContent = text || ''; }
function applyCustomDateInputs(){
  if(dateRangeDraftStart) customDateStart = dateRangeDraftStart;
  if(dateRangeFollowNow) customDateEnd = Number(snapshot?.timestamp || Date.now());
  else if(dateRangeDraftEnd) customDateEnd = dateRangeDraftEnd;
  normalizeCustomDateRange(snapshot || {});
  rangeFilter = 'customTime';
  localStorage.setItem('statsRange', rangeFilter);
  localStorage.setItem('customDateStart', String(customDateStart));
  localStorage.setItem('customDateEnd', String(customDateEnd));
  localStorage.setItem('dateRangeFollowNow', dateRangeFollowNow ? '1' : '0');
}
function setupAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); const sec = Math.max(5, Number(refreshEvery) || 30); autoRefreshTimer = setInterval(refreshNow, sec * 1000); }
async function load(){ setRefreshState(TXT.refresh); const first = await ipcRenderer.invoke('dashboard:getSnapshot'); render(first); if(!first?.ok) await refreshNow(); setupAutoRefresh(); }
async function refreshNow(){ setRefreshState(TXT.refresh); render(await ipcRenderer.invoke('dashboard:refresh')); setRefreshState(TXT.refreshed); setTimeout(() => setRefreshState(''), 800); }
readSessionMeta();
readSavedSessionViews();
applyZoom();
document.getElementById('refresh').onclick = refreshNow;
document.getElementById('settings').onclick = () => ipcRenderer.invoke('dashboard:settings');
const legacyLayoutButton = document.getElementById('layoutMode');
if(legacyLayoutButton) legacyLayoutButton.onclick = () => switchLayoutMode(layoutMode === 'compact' ? 'dashboard' : 'compact');
document.addEventListener('click', async (e) => {
  const dateControl = e.target.closest('.date-range-control');
  if(dateRangeOpen && !dateControl){
    dateRangeOpen = false;
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const dateToggle = e.target.closest('[data-date-range-toggle]');
  if(dateToggle){
    if(dateRangeOpen) dateRangeOpen = false;
    else openDateRangePopover();
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const dateQuick = e.target.closest('[data-date-range-quick]');
  if(dateQuick){
    setDateRangeQuick(dateQuick.dataset.dateRangeQuick || 'today');
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const dateFocus = e.target.closest('[data-date-range-focus]');
  if(dateFocus && dateFocus.dataset.dateRangeFocus){
    dateRangeFocus = dateFocus.dataset.dateRangeFocus;
    dateRangeMonth = monthStart(dateRangeFocus === 'end' ? dateRangeDraftEnd : dateRangeDraftStart);
  }
  const dateMonth = e.target.closest('[data-date-range-month]');
  if(dateMonth){
    ensureDateRangeDraft();
    const d = new Date(dateRangeMonth || monthStart(dateRangeDraftStart));
    d.setMonth(d.getMonth() + (dateMonth.dataset.dateRangeMonth === 'next' ? 1 : -1));
    dateRangeMonth = monthStart(d.getTime());
    localStorage.setItem('dateRangeMonth', String(dateRangeMonth));
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const dateDay = e.target.closest('[data-date-range-day]');
  if(dateDay){
    chooseCalendarDay(Number(dateDay.dataset.dateRangeDay));
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const dateCancel = e.target.closest('[data-date-range-cancel]');
  if(dateCancel){
    dateRangeOpen = false;
    dateRangeDraftStart = 0;
    dateRangeDraftEnd = 0;
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const dateConfirm = e.target.closest('[data-date-range-confirm]');
  if(dateConfirm){
    applyCustomDateInputs();
    dateRangeOpen = false;
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true });
    return;
  }
  const layoutModeBtn = e.target.closest('[data-layout-mode]');
  if(layoutModeBtn){
    switchLayoutMode(layoutModeBtn.dataset.layoutMode);
    return;
  }
  const compactPaneBtn = e.target.closest('[data-compact-pane]');
  if(compactPaneBtn){
    compactPane = compactPaneBtn.dataset.compactPane || 'overview';
    localStorage.setItem('compactPane', compactPane);
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true });
    return;
  }
  const compactPin = e.target.closest('[data-compact-pin]');
  if(compactPin){
    compactPinned = !compactPinned;
    localStorage.setItem('compactPinned', compactPinned ? '1' : '0');
    applyCompactWindowChrome();
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true });
    return;
  }
  const bulkMetaCancel = e.target.closest('[data-bulk-meta-cancel]');
  const bulkMetaBackdrop = e.target?.dataset?.modalBackdrop === 'bulk-meta';
  if(bulkMetaCancel || bulkMetaBackdrop){
    bulkMetaOpen = false;
    bulkMetaTagsDraft = '';
    bulkMetaNoteDraft = '';
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const bulkMetaSave = e.target.closest('[data-bulk-meta-save]');
  if(bulkMetaSave){ saveBulkMetaSheet(); return; }
  const renameCancel = e.target.closest('[data-rename-cancel]');
  const renameBackdrop = e.target?.dataset?.modalBackdrop === 'rename';
  if(renameCancel || renameBackdrop){
    renameSessionKey = '';
    renameDraft = '';
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const renameSave = e.target.closest('[data-rename-save]');
  if(renameSave){ await saveRenameSheet(); return; }
  const workspace = e.target.closest('[data-workspace]');
  if(workspace){ workspaceMode = workspace.dataset.workspace || 'analytics'; localStorage.setItem('workspaceMode', workspaceMode); if(workspaceMode === 'sessions'){ tableTab = 'sessions'; localStorage.setItem('statsTableTab', tableTab); } else if(tableTab === 'sessions'){ tableTab = 'requests'; localStorage.setItem('statsTableTab', tableTab); } if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true }); return; }
  const smartView = e.target.closest('[data-session-smart-view]');
  if(smartView){ applySessionSmartView(smartView.dataset.sessionSmartView || 'recent'); if(snapshot?.ok) render(snapshot); return; }
  const saveView = e.target.closest('[data-saved-session-save]');
  if(saveView){
    saveCurrentSessionView();
    setRefreshState(TXT.savedLocal);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const applySavedView = e.target.closest('[data-saved-session-apply]');
  if(applySavedView){
    const view = savedSessionViews.find((x) => x.id === applySavedView.dataset.savedSessionApply);
    applySavedSessionView(view);
    setRefreshState(TXT.savedViewApplied);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const deleteSavedView = e.target.closest('[data-saved-session-delete]');
  if(deleteSavedView){
    savedSessionViews = savedSessionViews.filter((x) => x.id !== deleteSavedView.dataset.savedSessionDelete);
    saveSavedSessionViews();
    setRefreshState(TXT.savedViewDeleted);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const advancedToggle = e.target.closest('[data-session-advanced-toggle]');
  if(advancedToggle){
    sessionAdvancedOpen = !sessionAdvancedOpen;
    localStorage.setItem('sessionAdvancedOpen', sessionAdvancedOpen ? '1' : '0');
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const analyticsAdvancedToggle = e.target.closest('[data-analytics-advanced-toggle]');
  if(analyticsAdvancedToggle){
    analyticsAdvancedOpen = !analyticsAdvancedOpen;
    localStorage.setItem('analyticsAdvancedOpen', analyticsAdvancedOpen ? '1' : '0');
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true });
    return;
  }
  const primaryFilter = e.target.closest('[data-session-primary-filter]');
  if(primaryFilter){
    const key = primaryFilter.dataset.sessionPrimaryFilter || 'all';
    sessionStatusFilter = key === 'archived' ? 'archived' : 'active';
    sessionQuickFilter = key === 'archived' ? 'all' : key;
    sessionTagFilter = 'all';
    if(key === 'cacheLow') sessionSort = 'opportunity';
    else if(sessionSort === 'opportunity') sessionSort = 'updated';
    saveSessionViewState();
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const quick = e.target.closest('[data-session-quick]');
  if(quick){ sessionQuickFilter = quick.dataset.sessionQuick || 'all'; localStorage.setItem('sessionQuickFilter', sessionQuickFilter); if(snapshot?.ok) render(snapshot); return; }
  const project = e.target.closest('[data-session-project]');
  if(project){ sessionProjectFilter = project.dataset.sessionProject || 'all'; localStorage.setItem('sessionProjectFilter', sessionProjectFilter); if(snapshot?.ok) render(snapshot); return; }
  const resetSessionFilters = e.target.closest('[data-session-reset-filters]');
  if(resetSessionFilters){
    sessionQuickFilter = 'all';
    sessionProjectFilter = 'all';
    sessionStatusFilter = 'active';
    sessionSort = 'updated';
    sessionTagFilter = 'all';
    sessionQuery = '';
    saveSessionViewState();
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const cacheGovernance = e.target.closest('[data-session-cache-governance]');
  if(cacheGovernance){
    const action = cacheGovernance.dataset.sessionCacheGovernance;
    if(action === 'focus'){
      sessionQuickFilter = 'cacheLow';
      sessionStatusFilter = 'active';
      sessionSort = 'opportunity';
      saveSessionViewState();
      if(snapshot?.ok) render(snapshot);
      return;
    }
    if(action === 'copy'){
      await navigator.clipboard.writeText(sessionCacheGovernanceReport(snapshot || {}));
      setRefreshState(TXT.cacheGovernanceCopied);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
      return;
    }
  }
  const checkAll = e.target.closest('[data-session-check-all]');
  if(checkAll){
    const all = sessionTableItems.map(sessionKeyFor);
    const allSelected = all.length && all.every((k) => selectedSessionKeys.has(k));
    if(allSelected) all.forEach((k) => selectedSessionKeys.delete(k));
    else all.forEach((k) => selectedSessionKeys.add(k));
    saveSelectedSessions();
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const check = e.target.closest('[data-session-check]');
  if(check){
    const key = check.dataset.sessionCheck;
    if(selectedSessionKeys.has(key)) selectedSessionKeys.delete(key); else selectedSessionKeys.add(key);
    saveSelectedSessions();
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const pin = e.target.closest('[data-session-pin]');
  if(pin){
    const key = pin.dataset.sessionPin;
    if(pinnedSessionKeys.has(key)) pinnedSessionKeys.delete(key); else pinnedSessionKeys.add(key);
    savePinnedSessions();
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const bulk = e.target.closest('[data-session-bulk]');
  if(bulk){
    const action = bulk.dataset.sessionBulk;
    const items = selectedSessionItems();
    if(action === 'select-all'){
      sessionTableItems.forEach((item) => selectedSessionKeys.add(sessionKeyFor(item)));
      saveSelectedSessions();
      if(snapshot?.ok) render(snapshot);
      return;
    }
    if(action === 'clear'){
      selectedSessionKeys.clear();
      saveSelectedSessions();
      if(snapshot?.ok) render(snapshot);
      return;
    }
    if(!items.length) return;
    if(action === 'tag'){
      bulkMetaOpen = true;
      bulkMetaTagsDraft = '';
      bulkMetaNoteDraft = '';
      if(snapshot?.ok) render(snapshot);
      requestAnimationFrame(() => document.querySelector('[data-bulk-meta-tags]')?.focus());
      return;
    }
    if(action === 'copy-summary') await navigator.clipboard.writeText(items.map(sessionSummaryText).join('\n\n---\n\n'));
    if(action === 'copy-markdown') await navigator.clipboard.writeText(items.map(sessionMarkdown).join('\n\n---\n\n'));
    if(action === 'copy-json') await navigator.clipboard.writeText(JSON.stringify(items, null, 2));
    if(action === 'copy-csv') await navigator.clipboard.writeText(sessionCsv(items));
    if(action === 'archive' || action === 'restore'){
      setRefreshState(TXT.refresh);
      for(const item of items) await ipcRenderer.invoke('dashboard:archiveSession', item, action === 'archive');
      selectedSessionKeys.clear();
      saveSelectedSessions();
      await refreshNow();
      return;
    }
    setRefreshState(TXT.actionDone);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    return;
  }
  const action = e.target.closest('[data-session-action]');
  if(action){
    const key = action.dataset.sessionKey || sessionTableItems[Number(action.dataset.sessionIndex)] && sessionKeyFor(sessionTableItems[Number(action.dataset.sessionIndex)]);
    const item = sessionTableItems.find((x) => sessionKeyFor(x) === key) || sessionByKey(key);
    if(!item) return;
    if(action.dataset.sessionAction === 'focus-requests'){
      tableTab = 'requests';
      analyticsQuery = item.id || '';
      workspaceMode = 'analytics';
      localStorage.setItem('workspaceMode', workspaceMode);
      localStorage.setItem('statsTableTab', tableTab);
      localStorage.setItem('statsAnalyticsQuery', analyticsQuery);
      if(snapshot?.ok) render(snapshot);
      return;
    }
    if(action.dataset.sessionAction === 'open') await ipcRenderer.invoke('dashboard:openSession', item);
    if(action.dataset.sessionAction === 'open-codearts') await ipcRenderer.invoke('dashboard:openCodeArtsSession', item);
    if(action.dataset.sessionAction === 'rename'){
      renameSessionKey = key;
      renameDraft = item.title || '';
      if(snapshot?.ok) render(snapshot);
      requestAnimationFrame(() => { const input = document.querySelector('[data-rename-input]'); input?.focus(); input?.select(); });
      return;
    }
    if(action.dataset.sessionAction === 'copy-summary') await navigator.clipboard.writeText(sessionSummaryText(item));
    if(action.dataset.sessionAction === 'copy-markdown') await navigator.clipboard.writeText(sessionMarkdown(item));
    if(action.dataset.sessionAction === 'copy-requests-json') await navigator.clipboard.writeText(JSON.stringify(sessionRequests(item), null, 2));
    if(action.dataset.sessionAction === 'copy') await ipcRenderer.invoke('dashboard:copySession', item);
    if(action.dataset.sessionAction === 'copy-id') await navigator.clipboard.writeText(item.id || '');
    if(action.dataset.sessionAction === 'copy-path') await navigator.clipboard.writeText(item.directory || '');
    if(action.dataset.sessionAction === 'copy-json') await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
    if(action.dataset.sessionAction === 'archive'){
      setRefreshState(TXT.refresh);
      await ipcRenderer.invoke('dashboard:archiveSession', item, action.dataset.archive !== 'false');
      await refreshNow();
    } else {
      setRefreshState(TXT.actionDone);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    }
    return;
  }
  const select = e.target.closest('[data-session-select]');
  if(select){ selectedSessionId = select.dataset.sessionSelect; localStorage.setItem('selectedSessionId', selectedSessionId); if(select.dataset.table){ tableTab = select.dataset.table; localStorage.setItem('statsTableTab', tableTab); layoutMode = 'dashboard'; localStorage.setItem('layoutMode', layoutMode); if(tableTab === 'sessions'){ workspaceMode = 'sessions'; localStorage.setItem('workspaceMode', workspaceMode); } } if(snapshot?.ok) render(snapshot); return; }
  const requestSelect = e.target.closest('[data-request-select]');
  if(requestSelect){
    selectedRequestKey = requestSelect.dataset.requestSelect;
    localStorage.setItem('selectedRequestKey', selectedRequestKey);
    if(requestSelect.dataset.table){
      tableTab = requestSelect.dataset.table;
      localStorage.setItem('statsTableTab', tableTab);
      layoutMode = 'dashboard';
      localStorage.setItem('layoutMode', layoutMode);
    }
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const requestAction = e.target.closest('[data-request-action]');
  if(requestAction){
    const item = requestByKey(requestAction.dataset.requestKey);
    if(!item) return;
    if(requestAction.dataset.requestAction === 'copy-json') await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
    if(requestAction.dataset.requestAction === 'copy-session') await navigator.clipboard.writeText(item.sessionId || '');
    if(requestAction.dataset.requestAction === 'view-session'){
      tableTab = 'sessions';
      selectedSessionId = `${sourceKey(item)}:${item.sessionId || ''}`;
      sessionQuery = item.sessionId || '';
      workspaceMode = 'sessions';
      localStorage.setItem('workspaceMode', workspaceMode);
      localStorage.setItem('statsTableTab', tableTab);
      localStorage.setItem('selectedSessionId', selectedSessionId);
      localStorage.setItem('statsSessionQuery', sessionQuery);
      if(snapshot?.ok) render(snapshot);
      return;
    }
    setRefreshState(TXT.copied);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    return;
  }
  const status = e.target.closest('[data-session-status]');
  if(status){ sessionStatusFilter = status.dataset.sessionStatus; localStorage.setItem('sessionStatusFilter', sessionStatusFilter); if(snapshot?.ok) render(snapshot); return; }
  const series = e.target.closest('[data-series]');
  if(series){ const key = series.dataset.series; if(visibleSeries.has(key)) visibleSeries.delete(key); else visibleSeries.add(key); saveVisibleSeries(); if(snapshot?.ok) render(snapshot); return; }
  const cacheModel = e.target.closest('[data-cache-model]');
  if(cacheModel){ modelFilter = cacheModel.dataset.cacheModel || 'all'; localStorage.setItem('statsModel', modelFilter); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true }); return; }
  const cacheProject = e.target.closest('[data-cache-project]');
  if(cacheProject){
    workspaceMode = 'sessions';
    sessionProjectFilter = cacheProject.dataset.cacheProject || 'all';
    sessionQuickFilter = 'cacheLow';
    sessionStatusFilter = 'all';
    tableTab = 'sessions';
    localStorage.setItem('workspaceMode', workspaceMode);
    localStorage.setItem('sessionProjectFilter', sessionProjectFilter);
    localStorage.setItem('sessionQuickFilter', sessionQuickFilter);
    localStorage.setItem('sessionStatusFilter', sessionStatusFilter);
    localStorage.setItem('statsTableTab', tableTab);
    if(snapshot?.ok) render(snapshot);
    return;
  }
  const src = e.target.closest('[data-source]');
  const rangeApply = e.target.closest('[data-range-apply]');
  const tab = e.target.closest('[data-table]');
  if(rangeApply){ applyCustomDateInputs(); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); return; }
  if(src){ sourceFilter = src.dataset.source; localStorage.setItem('statsSource', sourceFilter); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); }
  if(tab){ tableTab = tab.dataset.table; localStorage.setItem('statsTableTab', tableTab); if(tableTab === 'sessions'){ workspaceMode = 'sessions'; localStorage.setItem('workspaceMode', workspaceMode); } else { workspaceMode = 'analytics'; localStorage.setItem('workspaceMode', workspaceMode); } if(tab.closest('.compact-panel-actions')){ layoutMode = 'dashboard'; localStorage.setItem('layoutMode', layoutMode); } if(snapshot?.ok) render(snapshot); }
});
document.addEventListener('change', (e) => { const dateInput = e.target.closest('[data-date-range-date], [data-date-range-time]'); if(dateInput){ const which = dateInput.dataset.dateRangeDate || dateInput.dataset.dateRangeTime; const part = dateInput.dataset.dateRangeDate ? 'date' : 'time'; updateDateRangeDraft(which, part, dateInput.value); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); return; } const follow = e.target.closest('[data-date-range-follow]'); if(follow){ dateRangeFollowNow = follow.checked; if(dateRangeFollowNow) dateRangeDraftEnd = Number(snapshot?.timestamp || Date.now()); localStorage.setItem('dateRangeFollowNow', dateRangeFollowNow ? '1' : '0'); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); return; } const tags = e.target.closest('[data-session-tags]'); if(tags){ const key = tags.dataset.sessionTags; sessionMeta[key] = { ...(sessionMeta[key] || {}), tags: normalizeTags(tags.value) }; saveSessionMeta(); setRefreshState(TXT.savedLocal); clearTimeout(lastToastTimer); lastToastTimer = setTimeout(() => setRefreshState(''), 900); if(snapshot?.ok) render(snapshot); return; } const sel = e.target.closest('[data-select]'); if(!sel) return; if(sel.dataset.select === 'source'){ sourceFilter = sel.value; localStorage.setItem('statsSource', sourceFilter); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); } if(sel.dataset.select === 'model'){ modelFilter = sel.value; localStorage.setItem('statsModel', modelFilter); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); } if(sel.dataset.select === 'refresh'){ refreshEvery = sel.value; localStorage.setItem('statsRefreshEvery', refreshEvery); setupAutoRefresh(); } if(sel.dataset.select === 'range'){ rangeFilter = normalizeRangeFilter(sel.value); const days = Number(String(rangeFilter).replace('d', '')); if(Number.isFinite(days)) localStorage.setItem('customRangeDays', String(days)); localStorage.setItem('statsRange', rangeFilter); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); } if(sel.dataset.select === 'sessionSort'){ sessionSort = sel.value; localStorage.setItem('sessionSort', sessionSort); if(snapshot?.ok) render(snapshot); } if(sel.dataset.select === 'sessionTag'){ sessionTagFilter = sel.value; localStorage.setItem('sessionTagFilter', sessionTagFilter); if(snapshot?.ok) render(snapshot); } if(sel.dataset.select === 'sessionProject'){ sessionProjectFilter = sel.value; localStorage.setItem('sessionProjectFilter', sessionProjectFilter); if(snapshot?.ok) render(snapshot); } });
document.addEventListener('input', (e) => { const bulkTags = e.target.closest('[data-bulk-meta-tags]'); if(bulkTags){ bulkMetaTagsDraft = bulkTags.value; return; } const bulkNote = e.target.closest('[data-bulk-meta-note]'); if(bulkNote){ bulkMetaNoteDraft = bulkNote.value; return; } const savedViewName = e.target.closest('[data-saved-session-name]'); if(savedViewName){ savedSessionViewNameDraft = savedViewName.value; return; } const note = e.target.closest('[data-session-note]'); if(note){ const key = note.dataset.sessionNote; sessionMeta[key] = { ...(sessionMeta[key] || {}), note: note.value }; saveSessionMeta(); setRefreshState(TXT.savedLocal); clearTimeout(lastToastTimer); lastToastTimer = setTimeout(() => setRefreshState(''), 800); return; } const rename = e.target.closest('[data-rename-input]'); if(rename){ renameDraft = rename.value; return; } const q = e.target.closest('[data-query]'); if(!q) return; const scope = q.dataset.query === 'sessions' ? 'sessions' : 'analytics'; if(scope === 'sessions'){ sessionQuery = q.value; localStorage.setItem('statsSessionQuery', sessionQuery); } else { analyticsQuery = q.value; localStorage.setItem('statsAnalyticsQuery', analyticsQuery); } const app = document.getElementById('app'); app?.classList.add('is-typing'); clearTimeout(queryRenderTimer); queryRenderTimer = setTimeout(() => { queryRenderTimer = null; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true }); requestAnimationFrame(() => { const next = document.querySelector(`[data-query="${scope}"]`); if(next){ next.focus(); next.setSelectionRange(next.value.length, next.value.length); } app?.classList.remove('is-typing'); }); }, 140); });
document.addEventListener('keydown', async (e) => { if(dateRangeOpen && e.key === 'Escape'){ dateRangeOpen = false; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true }); return; } if(e.key === 'Enter' && e.target.closest('[data-saved-session-name]')){ saveCurrentSessionView(); if(snapshot?.ok) render(snapshot); return; } if(bulkMetaOpen && e.key === 'Escape'){ bulkMetaOpen = false; bulkMetaTagsDraft = ''; bulkMetaNoteDraft = ''; if(snapshot?.ok) render(snapshot); return; } if(!renameSessionKey) return; if(e.key === 'Escape'){ renameSessionKey = ''; renameDraft = ''; if(snapshot?.ok) render(snapshot); } if(e.key === 'Enter' && e.target.closest('[data-rename-input]')){ await saveRenameSheet(); } });
ipcRenderer.on('dashboard:snapshot', (_e, s) => { suppressChartIntro = true; render(s, { instantChart: true, windowLayout: false }); suppressChartIntro = false; setRefreshState(TXT.realtime); setTimeout(() => setRefreshState(''), 900); });
window.addEventListener('resize', () => {
  if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact') return;
  if(resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    bindChart(filterRows(snapshot), snapshot, { instant: true });
  });
});
load();
















