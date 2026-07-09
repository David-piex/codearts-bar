function updateLimitNote(kind, rendered, total){
  const note = document.querySelector(`[data-table-limit="${kind}"]`);
  if(!note) return;
  note.dataset.rendered = String(rendered);
  note.dataset.total = String(total);
  if(note.classList?.contains?.('table-page-note')){
    const isSessions = kind === 'sessions';
    const pageSize = isSessions ? SESSION_PAGE_SIZE : REQUEST_PAGE_SIZE;
    const current = isSessions ? sessionTablePage : requestTablePage;
    const totalPages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
    const page = Math.max(0, Math.min(totalPages - 1, Number(current || 0)));
    const displayCount = Number(rendered || 0) || Math.min(pageSize, Math.max(0, Number(total || 0) - page * pageSize));
    const start = page * pageSize + (displayCount ? 1 : 0);
    const end = Math.min(Number(total || 0), page * pageSize + displayCount);
    const span = note.querySelector('span');
    const label = isSessions ? (TXT.sessionPagination || '会话分页') : (TXT.requestPagination || '请求分页');
    if(span) span.textContent = `${label}：${n(start)}-${n(end)} / ${n(total)} · ${TXT.page || '第'} ${n(page + 1)} / ${n(totalPages)}`;
    const prefix = isSessions ? 'session' : 'request';
    const input = note.querySelector(`[data-${prefix}-page-input]`);
    if(input && document.activeElement !== input) input.value = String(page + 1);
    const prev = note.querySelector(`[data-${prefix}-page="prev"]`);
    const next = note.querySelector(`[data-${prefix}-page="next"]`);
    if(prev) prev.disabled = page <= 0;
    if(next) next.disabled = page >= totalPages - 1;
    return;
  }
  if(rendered >= total){ note.remove?.(); return; }
  const suffix = kind === 'sessions'
    ? '\u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22 / \u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002'
    : '\u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22\u7f29\u5c0f\u8303\u56f4\u3002';
  note.textContent = `\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} ${suffix}`;
}
function currentPageRangePayload(){
  if(!snapshot?.ok) return {};
  return { start: sinceForRange(snapshot), end: untilForRange(snapshot) };
}
function currentRequestPageOffset(page = requestTablePage){
  return Math.max(0, Number(page || 0)) * REQUEST_PAGE_SIZE;
}
function requestPagePayload(offset = currentRequestPageOffset(), limit = REQUEST_PAGE_SIZE){
  return {
    limit,
    offset,
    source: sourceFilter,
    model: modelFilter,
    range: currentPageRangePayload(),
    query: analyticsQuery,
  };
}
function requestPageCacheKey(page = requestTablePage){
  const payload = requestPagePayload(currentRequestPageOffset(page), REQUEST_PAGE_SIZE);
  return JSON.stringify({ ...payload, page: Number(page || 0) });
}
function invalidateRequestPageCache(){
  requestPageCache = { key: '', items: null, total: 0, page: 0, timestamp: 0 };
}
function resetRequestPaging(){
  requestTablePage = 0;
  requestTableRenderLimit = REQUEST_PAGE_SIZE;
  invalidateRequestPageCache();
  localStorage.setItem('requestTablePage', '0');
}
function canUseDbSessionPage(){
  return sessionQuickFilter === 'all' && sessionTagFilter === 'all' && sessionSort === 'updated';
}
function currentSessionPageOffset(page = sessionTablePage){
  return Math.max(0, Number(page || 0)) * SESSION_PAGE_SIZE;
}
function sessionPagePayload(offset = currentSessionPageOffset(), limit = SESSION_PAGE_SIZE){
  return {
    limit,
    offset,
    source: sourceFilter,
    status: sessionStatusFilter,
    project: sessionProjectFilter,
    range: currentPageRangePayload(),
    query: sessionQuery,
  };
}
function sessionPageCacheKey(page = sessionTablePage){
  const payload = sessionPagePayload(currentSessionPageOffset(page), SESSION_PAGE_SIZE);
  return JSON.stringify({ ...payload, page: Number(page || 0), quick: sessionQuickFilter, tag: sessionTagFilter, sort: sessionSort });
}
function invalidateSessionPageCache(){
  sessionPageCache = { key: '', items: null, total: 0, page: 0, timestamp: 0 };
}
function sessionRowsSignature(items = [], total = 0, page = sessionTablePage){
  return `${Number(page || 0)}:${Number(total || 0)}:${(items || []).map(sessionKeyFor).join('|')}`;
}
function sessionRowKeysSignature(items = [], page = sessionTablePage){
  return `${Number(page || 0)}:${(items || []).map(sessionKeyFor).join('|')}`;
}
function currentSessionRowsSignature(){
  const noteTotal = Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.total || 0);
  return sessionRowsSignature(sessionTableItems || [], noteTotal || (sessionTableItems || []).length, sessionTablePage);
}
function currentSessionRowKeysSignature(){
  return sessionRowKeysSignature(sessionTableItems || [], sessionTablePage);
}
function sameRangePayload(a = {}, b = {}){
  const ar = a.range || {};
  const br = b.range || {};
  return Number(ar.start || 0) === Number(br.start || 0) && Number(ar.end || 0) === Number(br.end || 0);
}
function sameRequestPagePayload(a = {}, b = {}){
  return Number(a.limit || REQUEST_PAGE_SIZE) === Number(b.limit || REQUEST_PAGE_SIZE)
    && Number(a.offset || 0) === Number(b.offset || 0)
    && String(a.source || 'all') === String(b.source || 'all')
    && String(a.model || 'all') === String(b.model || 'all')
    && String(a.query || '') === String(b.query || '')
    && sameRangePayload(a, b);
}
function sameSessionPagePayload(a = {}, b = {}){
  return Number(a.limit || SESSION_PAGE_SIZE) === Number(b.limit || SESSION_PAGE_SIZE)
    && Number(a.offset || 0) === Number(b.offset || 0)
    && String(a.source || 'all') === String(b.source || 'all')
    && String(a.status || 'active') === String(b.status || 'active')
    && String(a.project || 'all') === String(b.project || 'all')
    && String(a.query || '') === String(b.query || '')
    && sameRangePayload(a, b);
}
function hydrateRequestPageCacheFromSnapshot(s = snapshot || {}, page = requestTablePage){
  if(!s?.requestPage || !Array.isArray(s.requestPage.items)) return false;
  const expected = requestPagePayload(currentRequestPageOffset(page), REQUEST_PAGE_SIZE);
  const actual = s.requestPage.payload || {};
  const hasPayload = Object.keys(actual || {}).length > 0;
  if(hasPayload && !sameRequestPagePayload(actual, expected)) return false;
  const offset = Number(s.requestPage.offset ?? actual.offset ?? 0);
  const limit = Number(s.requestPage.limit ?? actual.limit ?? REQUEST_PAGE_SIZE);
  if(offset !== expected.offset || limit !== expected.limit) return false;
  const key = requestPageCacheKey(page);
  requestPageCache = {
    key,
    items: s.requestPage.items,
    total: Number(s.requestPage.total || s.requestPage.items.length),
    page: Number(page || 0),
    timestamp: Number(s.requestPage.snapshotTimestamp || s.timestamp || Date.now()),
  };
  mergeRequestPageItems(s.requestPage.items);
  return true;
}
function hydrateSessionPageCacheFromSnapshot(s = snapshot || {}, page = sessionTablePage){
  if(!s?.sessionPage || !Array.isArray(s.sessionPage.items) || !canUseDbSessionPage()) return false;
  const expected = sessionPagePayload(currentSessionPageOffset(page), SESSION_PAGE_SIZE);
  const actual = s.sessionPage.payload || {};
  const hasPayload = Object.keys(actual || {}).length > 0;
  if(hasPayload && !sameSessionPagePayload(actual, expected)) return false;
  const offset = Number(s.sessionPage.offset ?? actual.offset ?? 0);
  const limit = Number(s.sessionPage.limit ?? actual.limit ?? SESSION_PAGE_SIZE);
  if(offset !== expected.offset || limit !== expected.limit) return false;
  const key = sessionPageCacheKey(page);
  sessionPageCache = {
    key,
    items: s.sessionPage.items,
    total: Number(s.sessionPage.total || s.sessionPage.items.length),
    page: Number(page || 0),
    timestamp: Number(s.sessionPage.snapshotTimestamp || s.timestamp || Date.now()),
  };
  mergeSessionPageIntoSnapshot(s.sessionPage.items);
  return true;
}
function mergeSessionPageIntoSnapshot(items = []){
  if(!snapshot?.ok || !Array.isArray(items) || !items.length) return;
  const map = new Map((snapshot.sessions || []).map((item) => [sessionKeyFor(item), item]));
  for(const item of items) map.set(sessionKeyFor(item), item);
  snapshot.sessions = [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
function patchSessionTableRowsChunked(items = [], total = items.length, page = sessionTablePage){
  const tbody = document.querySelector('.session-scroll tbody');
  if(!tbody || typeof tbody.insertAdjacentHTML !== 'function') return false;
  const list = Array.isArray(items) ? items.slice(0, SESSION_PAGE_SIZE) : [];
  const token = ++sessionHydrationToken;
  sessionHydrationItems = list;
  sessionTableItems = list;
  tbody.innerHTML = '';
  let loading = document.querySelector('.session-row-loading');
  if(!loading){
    const scroller = document.querySelector('.session-scroll');
    scroller?.insertAdjacentHTML?.('beforeend', `<div class="session-row-loading">${TXT.loading || '正在加载'} ${n(list.length)} ${TXT.rows}</div>`);
    loading = document.querySelector('.session-row-loading');
  }
  let index = 0;
  const step = () => {
    if(token !== sessionHydrationToken || workspaceMode !== 'sessions') return;
    const chunk = list.slice(index, index + 6);
    if(chunk.length) tbody.insertAdjacentHTML('beforeend', chunk.map((item) => sessionRowHtml(item)).join(''));
    index += chunk.length;
    if(index < list.length){
      if(typeof requestIdleCallback === 'function') requestIdleCallback(step, { timeout: 90 });
      else if(typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(step, 12));
      else setTimeout(step, 24);
      return;
    }
    loading?.remove?.();
    updateLimitNote('sessions', list.length, total);
    const rowCount = document.querySelector('.session-toolbar .row-count');
    if(rowCount) rowCount.textContent = `${n(list.length)} ${TXT.rows}`;
    patchSessionSelectionChrome();
    patchSessionBulk();
    scheduleSessionInspectorPatch(0);
    bindIncrementalTables();
  };
  if(typeof requestIdleCallback === 'function') requestIdleCallback(step, { timeout: 90 });
  else if(typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(step, 12));
  else setTimeout(step, 24);
  return true;
}
async function refreshRequestPageCache(page = requestTablePage, opts = {}){
  if(!snapshot?.ok) return false;
  const key = requestPageCacheKey(page);
  if(!opts.force && requestPageCache?.key === key && Array.isArray(requestPageCache.items)) return true;
  if(requestPageLoading) return false;
  requestPageLoading = true;
  try {
    const payload = requestPagePayload(currentRequestPageOffset(page), REQUEST_PAGE_SIZE);
    const data = await ipcRenderer.invoke('dashboard:getRequestsPage', payload);
    if(!data?.ok || !Array.isArray(data.items)) return false;
    requestPageCache = { key, items: data.items, total: Number(data.total || data.items.length), page: Number(page || 0), timestamp: Number(data.snapshotTimestamp || Date.now()) };
    snapshot.requestPage = { ...data, payload, snapshotTimestamp: requestPageCache.timestamp };
    snapshot.requestTotal = Number(data.total || snapshot.requestTotal || data.items.length || 0);
    mergeRequestPageItems(data.items);
    return true;
  } catch (error) {
    console.warn('[dashboard] request page failed', error);
    return false;
  } finally {
    requestPageLoading = false;
  }
}
function scheduleRequestPageRefresh(s = snapshot || {}, page = requestTablePage){
  if(!snapshot?.ok) return;
  const key = requestPageCacheKey(page);
  if(requestPageCache?.key === key && Array.isArray(requestPageCache.items)) return;
  setTimeout(async () => {
    const ok = await refreshRequestPageCache(page, { force: true });
    if(ok && snapshot === s && workspaceMode === 'analytics' && tableTab === 'requests'){
      patchAnalyticsSlotsForState(s, { tableOnly: true });
    }
  }, 80);
}
function requestPageRowsForCurrentView(s = snapshot || {}){
  const key = requestPageCacheKey(requestTablePage);
  if((requestPageCache?.key !== key || !Array.isArray(requestPageCache.items)) && hydrateRequestPageCacheFromSnapshot(s, requestTablePage)){
    return { paged: true, list: requestPageCache.items, total: Number(requestPageCache.total || requestPageCache.items.length) };
  }
  if(requestPageCache?.key !== key || !Array.isArray(requestPageCache.items)){
    scheduleRequestPageRefresh(s, requestTablePage);
    return null;
  }
  return { paged: true, list: requestPageCache.items, total: Number(requestPageCache.total || requestPageCache.items.length) };
}
async function refreshSessionPageCache(page = sessionTablePage, opts = {}){
  if(!snapshot?.ok || !canUseDbSessionPage()) return false;
  const key = sessionPageCacheKey(page);
  if(!opts.force && sessionPageCache?.key === key && Array.isArray(sessionPageCache.items)) return true;
  if(sessionPageLoading) return false;
  sessionPageLoading = true;
  try {
    const data = await ipcRenderer.invoke('dashboard:getSessionsPage', sessionPagePayload(currentSessionPageOffset(page), SESSION_PAGE_SIZE));
    if(!data?.ok || !Array.isArray(data.items)) return false;
    sessionPageCache = { key, items: data.items, total: Number(data.total || data.items.length), page: Number(page || 0), timestamp: Number(data.snapshotTimestamp || Date.now()) };
    mergeSessionPageIntoSnapshot(data.items);
    return true;
  } catch (error) {
    console.warn('[dashboard] session page failed', error);
    return false;
  } finally {
    sessionPageLoading = false;
  }
}
function scheduleSessionPageRefresh(s = snapshot || {}, page = sessionTablePage){
  if(!canUseDbSessionPage() || !snapshot?.ok) return;
  const key = sessionPageCacheKey(page);
  if(sessionPageCache?.key === key && Array.isArray(sessionPageCache.items)) return;
  clearTimeout(sessionPageRefreshTimer);
  sessionPageRefreshTimer = setTimeout(async () => {
    sessionPageRefreshTimer = null;
    const beforeSignature = currentSessionRowsSignature();
    const beforeKeys = currentSessionRowKeysSignature();
    const ok = await refreshSessionPageCache(page, { force: true });
    if(ok && snapshot === s && workspaceMode === 'sessions'){
      const afterItems = sortSessions((sessionPageCache.items || []).filter(sessionMatches)).slice(0, SESSION_PAGE_SIZE);
      const afterSignature = sessionRowsSignature(afterItems, Number(sessionPageCache.total || 0), page);
      const afterKeys = sessionRowKeysSignature(afterItems, page);
      if(beforeSignature === afterSignature) return;
      if(beforeKeys === afterKeys){
        updateLimitNote('sessions', afterItems.length, Number(sessionPageCache.total || 0));
        return;
      }
      if(patchSessionTableRowsChunked(afterItems, Number(sessionPageCache.total || 0), page)) return;
      const patch = () => {
        if(snapshot === s && workspaceMode === 'sessions') patchSessionView(s, { table: true, toolbar: false, inspector: true, overview: false });
      };
      if(typeof requestIdleCallback === 'function') requestIdleCallback(patch, { timeout: 500 });
      else setTimeout(patch, 60);
    }
  }, 120);
}
function sessionPageRowsForCurrentView(s = snapshot || {}){
  if(!canUseDbSessionPage()) return null;
  const key = sessionPageCacheKey(sessionTablePage);
  if((sessionPageCache?.key !== key || !Array.isArray(sessionPageCache.items)) && hydrateSessionPageCacheFromSnapshot(s, sessionTablePage)){
    return { paged: true, list: sessionPageCache.items, total: Number(sessionPageCache.total || sessionPageCache.items.length) };
  }
  if(sessionPageCache?.key !== key || !Array.isArray(sessionPageCache.items)){
    scheduleSessionPageRefresh(s, sessionTablePage);
    return null;
  }
  return { paged: true, list: sessionPageCache.items, total: Number(sessionPageCache.total || sessionPageCache.items.length) };
}
function mergeRequestPageItems(items = []){
  if(!snapshot?.ok || !Array.isArray(items) || !items.length) return items || [];
  const seen = new Set((snapshot.requestLog || []).map(requestKeyFor));
  const fresh = [];
  for(const item of items){
    const key = requestKeyFor(item);
    if(seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  if(fresh.length) snapshot.requestLog = [...(snapshot.requestLog || []), ...fresh].sort((a, b) => (b.time || 0) - (a.time || 0));
  return fresh;
}
function mergeSessionPageItems(items = []){
  if(!snapshot?.ok || !Array.isArray(items) || !items.length) return items || [];
  const seen = new Set((snapshot.sessions || []).map(sessionKeyFor));
  const fresh = [];
  for(const item of items){
    const key = sessionKeyFor(item);
    if(seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }
  if(fresh.length) snapshot.sessions = [...(snapshot.sessions || []), ...fresh].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return fresh;
}
async function loadRequestPage(offset, limit = REQUEST_PAGE_SIZE){
  if(requestPageLoading) return null;
  requestPageLoading = true;
  try {
    return await ipcRenderer.invoke('dashboard:getRequestsPage', requestPagePayload(offset, limit));
  } catch (error) {
    console.warn('[dashboard] request page failed', error);
    return null;
  } finally {
    requestPageLoading = false;
  }
}
async function loadSessionPage(offset, limit = SESSION_PAGE_SIZE){
  if(sessionPageLoading) return null;
  sessionPageLoading = true;
  try {
    return await ipcRenderer.invoke('dashboard:getSessionsPage', sessionPagePayload(offset, limit));
  } catch (error) {
    console.warn('[dashboard] session page failed', error);
    return null;
  } finally {
    sessionPageLoading = false;
  }
}
async function appendRequestRows(){
  if(document.querySelector('[data-table-limit="requests"].table-page-note')) return false;
  if(!snapshot?.ok) return false;
  const tbody = document.querySelector('.request-main tbody');
  if(!tbody || typeof tbody.insertAdjacentHTML !== 'function') return render(snapshot, { windowLayout:false, instantChart:true, partial:true });
  const started = perfNow();
  const before = Math.max(REQUEST_PAGE_SIZE, Number(requestTableRenderLimit || REQUEST_PAGE_SIZE));
  const paged = requestPageMatchesTable(snapshot);
  const rows = paged ? (snapshot.requestPage.items || []) : applyTableSearch(getFilteredRowsForView(snapshot));
  const totalRows = paged ? Number(snapshot.requestPage.total || rows.length) : rows.length;
  const next = Math.min(before + REQUEST_PAGE_SIZE, rows.length, 5000);
  let chunkItems = rows.slice(before, next);
  let total = totalRows;
  let renderedNext = before + chunkItems.length;
  if(!chunkItems.length){
    const page = await loadRequestPage(before, REQUEST_PAGE_SIZE);
    if(!page?.ok || !Array.isArray(page.items) || !page.items.length) return false;
    chunkItems = page.items;
    mergeRequestPageItems(page.items);
    total = Number(page.total || before + chunkItems.length);
    renderedNext = before + chunkItems.length;
  }
  const chunk = chunkItems.map(requestRowHtml).join('');
  if(chunk) tbody.insertAdjacentHTML('beforeend', chunk);
  requestTableRenderLimit = renderedNext;
  updateLimitNote('requests', renderedNext, total);
  console.debug(`[dashboard] append request rows ${Math.round(perfNow() - started)}ms rows=${before}->${renderedNext}/${total}`);
  return true;
}
async function appendSessionRows(){
  return false;
}

function hydrateSessionRows(){
  const tbody = document.querySelector('.session-scroll tbody[data-session-deferred="1"]');
  if(!tbody || typeof tbody.insertAdjacentHTML !== 'function') return false;
  const loading = document.querySelector('.session-row-loading');
  const items = Array.isArray(sessionHydrationItems) ? sessionHydrationItems.slice() : [];
  const token = sessionHydrationToken;
  let index = 0;
  tbody.innerHTML = '';
  const schedule = (fn) => {
    if(typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 90 });
    else if(typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 12));
    else setTimeout(fn, 24);
  };
  const step = () => {
    if(token !== sessionHydrationToken || workspaceMode !== 'sessions') return;
    const chunk = items.slice(index, index + 6);
    if(chunk.length) tbody.insertAdjacentHTML('beforeend', chunk.map((item) => sessionRowHtml(item, false)).join(''));
    index += chunk.length;
    if(index < items.length){
      schedule(step);
      return;
    }
    tbody.removeAttribute('data-session-deferred');
    loading?.remove?.();
    patchSessionSelectionChrome();
    bindIncrementalTables();
  };
  schedule(step);
  return true;
}
