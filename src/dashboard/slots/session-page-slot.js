// Session table page slot: DB page cache, row patching, and chunked hydration.

function patchSessionTablePageRows(s = snapshot || {}, opts = {}){
  if(!snapshot?.ok || workspaceMode !== 'sessions') return false;
  const slot = document.getElementById('sessionTableSlot');
  const tbody = slot?.querySelector?.('.session-scroll tbody');
  if(!slot || !tbody || typeof tablePaginationHtml !== 'function') return false;
  const started = perfNow();
  const limit = SESSION_PAGE_SIZE;
  const dbPage = typeof sessionPageRowsForCurrentView === 'function' ? sessionPageRowsForCurrentView(s) : null;
  if(typeof shouldDeferSessionDbFallback === 'function' && shouldDeferSessionDbFallback(s, dbPage)) return false;
  const filtered = dbPage?.paged ? sortSessions((dbPage.list || []).filter(sessionMatches)) : sortSessions((s.sessions || []).filter(sessionMatches));
  const total = dbPage?.paged ? Math.max(Number(dbPage.total || 0), filtered.length) : filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  sessionTablePage = Math.max(0, Math.min(totalPages - 1, Number(sessionTablePage || 0)));
  localStorage.setItem('sessionTablePage', String(sessionTablePage));
  const start = sessionTablePage * limit;
  const list = dbPage?.paged ? filtered.slice(0, limit) : filtered.slice(start, start + limit);
  sessionTableRenderLimit = limit;
  sessionTableItems = list;
  sessionHydrationToken += 1;
  sessionHydrationItems = [];
  const visibleKeys = new Set(list.map(sessionKeyFor));
  for(const key of [...selectedSessionKeys]) if(dbPage?.paged ? !visibleKeys.has(key) : !filtered.some((x) => sessionKeyFor(x) === key)) selectedSessionKeys.delete(key);
  saveSelectedSessions();
  if(selectedSessionId && (dbPage?.paged ? !visibleKeys.has(selectedSessionId) : !filtered.some((x) => sessionKeyFor(x) === selectedSessionId))) selectedSessionId = '';
  if(!selectedSessionId && list[0]) selectedSessionId = sessionKeyFor(list[0]);
  try { lastCommittedHtml = ''; } catch {}
  tbody.removeAttribute('data-session-deferred');
  tbody.innerHTML = list.length ? list.map(sessionRowHtml).join('') : emptyRow(9);
  slot.querySelector?.('.session-row-loading')?.remove?.();
  replaceTablePagination('sessions', tablePaginationHtml('sessions', list.length, total, sessionTablePage, SESSION_PAGE_SIZE), slot);
  clearPagedTableLoading?.('sessions');
  updateLimitNote('sessions', list.length, total);
  const allBox = slot.querySelector('[data-session-check-all]');
  if(allBox) allBox.checked = Boolean(list.length && list.every((item) => selectedSessionKeys.has(sessionKeyFor(item))));
  const rowCount = document.querySelector('.session-toolbar .row-count');
  if(rowCount) rowCount.textContent = `${n(list.length)} ${TXT.rows}`;
  patchSessionSelectionChrome();
  patchSessionBulk();
  if(opts.inspector !== false) scheduleSessionInspectorPatch(0);
  scrollPagedTableToTop('sessions');
  bindIncrementalTables();
  markPerfStage('domCommitMs', perfNow() - started);
  if(!currentRenderPerf) recordPatchPerf('sessions:page-row-patch', started, list.length, { domCommitMs: Math.round(perfNow() - started) });
  return true;
}
async function ensureSessionPageInBoundsAfterLoad(){
  const total = Number(sessionPageCache?.total || 0);
  const maxPage = maxTablePageIndex(total, SESSION_PAGE_SIZE);
  if(total <= 0 && Number(sessionTablePage || 0) > 0){
    sessionTablePage = 0;
    sessionTableRenderLimit = SESSION_PAGE_SIZE;
    localStorage.setItem('sessionTablePage', '0');
    sessionPageCache = { ...sessionPageCache, key: sessionPageCacheKey(0), page: 0, items: [], total: 0 };
    if(snapshot?.sessionPage) snapshot.sessionPage = { ...snapshot.sessionPage, offset: 0, payload: sessionPagePayload(0, SESSION_PAGE_SIZE), items: [], total: 0 };
    syncPagedTableInput('sessions', 0, 0, SESSION_PAGE_SIZE);
    return true;
  }
  if(total > 0 && Number(sessionTablePage || 0) > maxPage){
    sessionTablePage = maxPage;
    sessionTableRenderLimit = SESSION_PAGE_SIZE;
    localStorage.setItem('sessionTablePage', String(sessionTablePage));
    await refreshSessionPageCache(sessionTablePage, { force: true });
    syncPagedTableInput('sessions', total, sessionTablePage, SESSION_PAGE_SIZE);
    return true;
  }
  syncPagedTableInput('sessions', total, sessionTablePage, SESSION_PAGE_SIZE);
  return false;
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
function sameSessionPagePayload(a = {}, b = {}){
  return Number(a.limit || SESSION_PAGE_SIZE) === Number(b.limit || SESSION_PAGE_SIZE)
    && Number(a.offset || 0) === Number(b.offset || 0)
    && String(a.source || 'all') === String(b.source || 'all')
    && String(a.status || 'active') === String(b.status || 'active')
    && String(a.project || 'all') === String(b.project || 'all')
    && String(a.query || '') === String(b.query || '')
    && sameRangePayload(a, b);
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
async function refreshSessionPageCache(page = sessionTablePage, opts = {}){
  if(!snapshot?.ok || !canUseDbSessionPage()) return false;
  const key = sessionPageCacheKey(page);
  if(!opts.force && sessionPageCache?.key === key && Array.isArray(sessionPageCache.items)) return true;
  if(sessionPageLoading && !opts.force) return false;
  const token = ++sessionPageLoadToken;
  sessionPageLoading = true;
  try {
    const data = await ipcRenderer.invoke('dashboard:getSessionsPage', sessionPagePayload(currentSessionPageOffset(page), SESSION_PAGE_SIZE));
    if(token !== sessionPageLoadToken) return false;
    if(!data?.ok || !Array.isArray(data.items)) return false;
    sessionPageCache = { key, items: data.items, total: Number(data.total || data.items.length), page: Number(page || 0), timestamp: Number(data.snapshotTimestamp || Date.now()) };
    mergeSessionPageIntoSnapshot(data.items);
    return true;
  } catch (error) {
    console.warn('[dashboard] session page failed', error);
    return false;
  } finally {
    if(token === sessionPageLoadToken) sessionPageLoading = false;
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
      if(patchSessionTablePageRows(s, { inspector: false })) return;
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
