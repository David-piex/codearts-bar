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
let SESSION_PAGE_SIZE = normalizeTablePageSize(initialStateValue('sessionPageSize'), 50);
let REQUEST_PAGE_SIZE = normalizeTablePageSize(initialStateValue('requestPageSize'), 100);
let requestTableRenderLimit = REQUEST_PAGE_SIZE;
let sessionTableRenderLimit = SESSION_PAGE_SIZE;
let requestTablePage = Math.max(0, Number(initialStateValue('requestTablePage', '0')) || 0);
let sessionTablePage = Math.max(0, Number(initialStateValue('sessionTablePage', '0')) || 0);
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
