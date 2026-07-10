// Request table page slot: DB page cache, row patching, and incremental append.

function patchRequestTablePageRows(s = snapshot || {}){
  if(!snapshot?.ok || workspaceMode !== 'analytics' || tableTab !== 'requests') return false;
  const main = document.querySelector('.request-main');
  const tbody = main?.querySelector?.('tbody');
  if(!main || !tbody || typeof tablePaginationHtml !== 'function' || typeof requestTableData !== 'function') return false;
  const started = perfNow();
  const rows = typeof getFilteredRowsForView === 'function' ? getFilteredRowsForView(s) : (s.requestLog || []);
  const data = requestTableData(rows, s);
  if(!data) return false;
  const list = Array.isArray(data.list) ? data.list.slice(0, REQUEST_PAGE_SIZE) : [];
  const body = data.loading
    ? `<tr><td colspan="15" class="empty-cell table-loading-cell">正在加载第 ${n(Number(requestTablePage || 0) + 1)} 页...</td></tr>`
    : (list.length ? list.map(requestRowHtml).join('') : emptyRow(15));
  try { lastCommittedHtml = ''; } catch {}
  tbody.innerHTML = body;
  replaceTablePagination('requests', tablePaginationHtml('requests', list.length, data.total, requestTablePage, REQUEST_PAGE_SIZE, data.loading), main);
  clearPagedTableLoading?.('requests');
  const rowCount = document.querySelector('#analyticsTableSlot .table-toolbar .row-count');
  if(rowCount) rowCount.textContent = `${n(Number(data.total || list.length || 0))} ${TXT.rows}`;
  requestTableRenderLimit = REQUEST_PAGE_SIZE;
  updateLimitNote('requests', list.length, Number(data.total || list.length || 0));
  patchRequestSelection();
  scrollPagedTableToTop('requests');
  bindIncrementalTables();
  markPerfStage('domCommitMs', perfNow() - started);
  if(!currentRenderPerf) recordPatchPerf('requests:page-row-patch', started, list.length, { domCommitMs: Math.round(perfNow() - started) });
  return true;
}
async function ensureRequestPageInBoundsAfterLoad(){
  const total = Number(requestPageCache?.total || 0);
  const maxPage = maxTablePageIndex(total, REQUEST_PAGE_SIZE);
  if(total <= 0 && Number(requestTablePage || 0) > 0){
    requestTablePage = 0;
    requestTableRenderLimit = REQUEST_PAGE_SIZE;
    localStorage.setItem('requestTablePage', '0');
    requestPageCache = { ...requestPageCache, key: requestPageCacheKey(0), page: 0, items: [], total: 0 };
    if(snapshot?.requestPage) snapshot.requestPage = { ...snapshot.requestPage, offset: 0, payload: requestPagePayload(0, REQUEST_PAGE_SIZE), items: [], total: 0 };
    syncPagedTableInput('requests', 0, 0, REQUEST_PAGE_SIZE);
    return true;
  }
  if(total > 0 && Number(requestTablePage || 0) > maxPage){
    requestTablePage = maxPage;
    requestTableRenderLimit = REQUEST_PAGE_SIZE;
    localStorage.setItem('requestTablePage', String(requestTablePage));
    await refreshRequestPageCache(requestTablePage, { force: true });
    syncPagedTableInput('requests', total, requestTablePage, REQUEST_PAGE_SIZE);
    return true;
  }
  syncPagedTableInput('requests', total, requestTablePage, REQUEST_PAGE_SIZE);
  return false;
}
async function patchAnalyticsAfterRequestPageRefresh(opts = {}){
  if(!snapshot?.ok || workspaceMode !== 'analytics') return false;
  setRefreshState(TXT.refresh);
  await refreshRequestPageCache(requestTablePage, { force: true });
  await ensureRequestPageInBoundsAfterLoad();
  const ok = patchAnalyticsSlotsForState(snapshot, opts);
  setRefreshState(TXT.refreshed);
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => setRefreshState(''), 700);
  return ok;
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
function sameRequestPagePayload(a = {}, b = {}){
  return Number(a.limit || REQUEST_PAGE_SIZE) === Number(b.limit || REQUEST_PAGE_SIZE)
    && Number(a.offset || 0) === Number(b.offset || 0)
    && String(a.source || 'all') === String(b.source || 'all')
    && String(a.model || 'all') === String(b.model || 'all')
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
async function refreshRequestPageCache(page = requestTablePage, opts = {}){
  if(!snapshot?.ok) return false;
  const key = requestPageCacheKey(page);
  if(!opts.force && requestPageCache?.key === key && Array.isArray(requestPageCache.items)) return true;
  if(requestPageLoading && !opts.force) return false;
  const token = ++requestPageLoadToken;
  requestPageLoading = true;
  try {
    const payload = requestPagePayload(currentRequestPageOffset(page), REQUEST_PAGE_SIZE);
    const data = await ipcRenderer.invoke('dashboard:getRequestsPage', payload);
    if(token !== requestPageLoadToken) return false;
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
    if(token === requestPageLoadToken) requestPageLoading = false;
  }
}
function scheduleRequestPageRefresh(s = snapshot || {}, page = requestTablePage){
  if(!snapshot?.ok) return;
  const key = requestPageCacheKey(page);
  if(requestPageCache?.key === key && Array.isArray(requestPageCache.items)) return;
  setTimeout(async () => {
    const ok = await refreshRequestPageCache(page, { force: true });
    if(ok && snapshot === s && workspaceMode === 'analytics' && tableTab === 'requests'){
      if(!patchRequestTablePageRows(s)) patchAnalyticsSlotsForState(s, { tableOnly: true });
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
