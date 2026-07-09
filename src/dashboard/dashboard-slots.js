function analyticsEmptyState(rows){
  if(rows.length) return '';
  return `<section class="dashboard-empty-state analytics-empty-state"><div><b>${TXT.emptyAnalyticsTitle}</b><span>${TXT.emptyAnalyticsHint}</span></div><button data-date-range-toggle="1">${TXT.dateRange}</button><button data-source="all">${TXT.allSource}</button></section>`;
}
function rememberSlotHtml(id, html){
  try { if(slotHtmlCache) slotHtmlCache.set(id, html); } catch {}
}
function patchHtmlSlot(id, html){
  const el = document.getElementById(id);
  if(!el) return false;
  const next = String(html ?? '');
  try { if(slotHtmlCache?.get(id) === next) return true; } catch {}
  rememberSlotHtml(id, next);
  try { lastCommittedHtml = ''; } catch {}
  el.innerHTML = next;
  return true;
}
function analyticsSlotsReady(){
  if(typeof document.querySelector !== 'function') return false;
  return Boolean(document.querySelector('#analyticsSummarySlot') && document.querySelector('#analyticsChartSlot') && document.querySelector('#analyticsTableSlot'));
}
function analyticsTableHtml(rows, s){ const t = perfNow(); const html = renderTable(rows, s); markPerfStage('lowerRenderMs', perfNow() - t); return html; }
function analyticsAdvancedHtml(rows, s){ const t = perfNow(); const html = renderAnalyticsAdvanced(rows, s); markPerfStage('lowerRenderMs', perfNow() - t); return html; }
function analyticsDeferredHtml(label = TXT.updatingDetails || '正在更新明细...'){
  return `<div class="analytics-deferred"><span>${esc(label)}</span></div>`;
}
function scheduleAnalyticsDeferredPatches(token, rows, s){
  const stillValid = () => token === analyticsDeferredToken && snapshot === s && layoutMode === 'dashboard' && workspaceMode === 'analytics';
  const defer = (delay, fn) => setTimeout(() => {
    if(!stillValid()) return;
    fn();
  }, delay);
  defer(16, () => patchHtmlSlot('analyticsAgentSlot', renderAgentRhythm(s)));
  defer(72, () => {
    patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
    bindIncrementalTables();
  });
  defer(180, () => {
    patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
    bindIncrementalTables();
  });
}
function analyticsShellHtml(s, rows, opts = {}){
  const deferHeavy = opts.deferHeavy === true;
  const tableHtml = deferHeavy ? analyticsDeferredHtml(TXT.updatingDetails || '正在更新明细...') : analyticsTableHtml(rows, s);
  const advancedHtml = deferHeavy ? '' : analyticsAdvancedHtml(rows, s);
  const agentHtml = deferHeavy ? analyticsDeferredHtml(TXT.updatingAgentIdle || '正在更新 Agent idle...') : renderAgentRhythm(s);
  return `${headerHtml(false)}<div id="analyticsFiltersSlot">${filtersHtml(s)}</div><div id="analyticsSummarySlot">${renderSummary(rows, s)}</div><div id="analyticsEmptySlot">${analyticsEmptyState(rows)}</div><div id="analyticsChartSlot">${renderChart(rows, s)}</div><div id="analyticsAgentSlot">${agentHtml}</div><div id="analyticsTableSlot">${tableHtml}</div><div id="analyticsAdvancedSlot">${advancedHtml}</div>`;
}
function patchSubSlotHtml(cacheKey, el, html){
  if(!el) return false;
  const next = String(html ?? '');
  try { if(slotHtmlCache?.get(cacheKey) === next) return true; } catch {}
  rememberSlotHtml(cacheKey, next);
  try { lastCommittedHtml = ''; } catch {}
  el.innerHTML = next;
  return true;
}
function patchChartChrome(rows, s){
  const slot = document.getElementById('analyticsChartSlot');
  const canvas = document.getElementById('usageChart');
  if(!slot || !canvas || !document.createElement) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderChart(rows, s);
  const nextHead = tmp.querySelector?.('.card-head');
  const currentHead = slot.querySelector?.('.card-head');
  if(nextHead && currentHead) patchSubSlotHtml('chart:head', currentHead, nextHead.innerHTML);
  if(chartPinnedIndex < 0){
    const nextUnderbar = tmp.querySelector?.('.chart-underbar');
    const currentUnderbar = slot.querySelector?.('.chart-underbar');
    if(nextUnderbar && currentUnderbar) patchSubSlotHtml('chart:underbar', currentUnderbar, nextUnderbar.innerHTML);
    const nextScrubber = tmp.querySelector?.('#chartHoverScrubber');
    const currentScrubber = document.getElementById('chartHoverScrubber');
    if(nextScrubber && currentScrubber) patchSubSlotHtml('chart:scrubber', currentScrubber, nextScrubber.innerHTML);
  }
  return true;
}
function patchAnalyticsView(s, rows, opts = {}){
  if(!analyticsSlotsReady()) return false;
  patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
  patchHtmlSlot('analyticsSummarySlot', renderSummary(rows, s));
  patchHtmlSlot('analyticsEmptySlot', analyticsEmptyState(rows));
  patchChartChrome(rows, s);
  const token = ++analyticsDeferredToken;
  if(opts.deferHeavy === true){
    patchHtmlSlot('analyticsAgentSlot', analyticsDeferredHtml(TXT.updatingAgentIdle || '正在更新 Agent idle...'));
    patchHtmlSlot('analyticsTableSlot', analyticsDeferredHtml(TXT.updatingDetails || '正在更新明细...'));
    patchHtmlSlot('analyticsAdvancedSlot', '');
    scheduleAnalyticsDeferredPatches(token, rows, s);
  } else {
    patchHtmlSlot('analyticsAgentSlot', renderAgentRhythm(s));
    patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
    patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
  }
  return true;
}
function currentAnalyticsRows(s = snapshot || {}){
  return getFilteredRowsForView(s);
}
function scheduleChartBind(rows, s, opts = {}, delay = 42, after = null){
  const token = ++chartBindToken;
  if(chartBindTimer) clearTimeout(chartBindTimer);
  if(chartBindFrame) cancelAnimationFrame(chartBindFrame);
  chartBindTimer = setTimeout(() => {
    chartBindTimer = null;
    const commit = () => {
      if(token !== chartBindToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
      chartBindFrame = requestAnimationFrame(() => {
        chartBindFrame = null;
        if(token !== chartBindToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
        bindChart(rows, s, opts);
        if(typeof ensureChartResizeObserver === 'function') ensureChartResizeObserver();
        if(typeof after === 'function') after();
      });
    };
    const preferIdleBind = opts.resize === true || opts.settled === true || delay > 80;
    if(preferIdleBind && typeof requestIdleCallback === 'function'){
      requestIdleCallback(commit, { timeout: opts.resize === true ? 900 : 700 });
      return;
    }
    if(preferIdleBind){
      setTimeout(commit, opts.resize === true ? 120 : 80);
      return;
    }
    let bound = false;
    const bindNow = () => {
      if(bound) return;
      bound = true;
      if(chartBindFrame){ try { cancelAnimationFrame(chartBindFrame); } catch {} }
      chartBindFrame = null;
      if(token !== chartBindToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
      bindChart(rows, s, opts);
      if(typeof ensureChartResizeObserver === 'function') ensureChartResizeObserver();
      if(typeof after === 'function') after();
    };
    chartBindFrame = requestAnimationFrame(bindNow);
    setTimeout(bindNow, 48);
    try { Promise.resolve().then(bindNow); } catch {}
  }, Math.max(0, Number(delay || 0)));
}
function patchAnalyticsSlotsForState(s = snapshot || {}, opts = {}){
  if(!analyticsSlotsReady() || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return false;
  const started = perfNow();
  const rows = currentAnalyticsRows(s);
  if(opts.tableOnly === true){
    patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
    bindIncrementalTables();
    if(!currentRenderPerf) recordPatchPerf('analytics:table-patch', started, rows.length, { domCommitMs: Math.round(perfNow() - started) });
    return true;
  }
  if(opts.lowerOnly === true){
    patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
    patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
    bindIncrementalTables();
    if(!currentRenderPerf) recordPatchPerf('analytics:lower-patch', started, rows.length, { domCommitMs: Math.round(perfNow() - started) });
    return true;
  }
  setInteractionMode('is-filtering', 190);
  if(!patchAnalyticsView(s, rows, opts)) return false;
  if(!currentRenderPerf) recordPatchPerf('analytics:slots-patch', started, rows.length, { domCommitMs: Math.round(perfNow() - started) });
  bindIncrementalTables();
  scheduleDashboardAggregates(s, opts);
  scheduleChartBind(rows, s, { instant: true, patch: true }, opts.chartDelayMs ?? 220);
  return true;
}
function patchAnalyticsChartOnly(s = snapshot || {}){
  if(!analyticsSlotsReady() || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return false;
  const rows = currentAnalyticsRows(s);
  patchChartChrome(rows, s);
  scheduleChartBind(rows, s, { instant: true, series: true }, 0);
  return true;
}
function patchAnalyticsFiltersOnly(s = snapshot || {}){
  if(!analyticsSlotsReady() || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return false;
  return patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
}
function currentRequestTableList(rows = currentAnalyticsRows(snapshot || {})){
  const matched = applyTableSearch(rows);
  const limit = Math.max(100, Number(requestTableRenderLimit || 100));
  return matched.slice(0, limit);
}
function patchRequestSelection(){
  if(layoutMode !== 'dashboard' || workspaceMode !== 'analytics' || tableTab !== 'requests') return false;
  if(typeof document.querySelector !== 'function' || typeof document.querySelectorAll !== 'function') return false;
  const manager = document.querySelector('.request-manager');
  if(!manager) return false;
  const list = currentRequestTableList();
  if(!list.length) return false;
  if(!list.some((r) => requestKeyFor(r) === selectedRequestKey)) selectedRequestFrom(list);
  document.querySelectorAll('.request-row.selected').forEach((row) => row.classList.remove('selected'));
  document.querySelectorAll('[data-request-select]').forEach((row) => {
    if(row?.dataset?.requestSelect === selectedRequestKey) row.classList.add('selected');
  });
  return true;
}
function patchDashboardAggregateSlots(s = snapshot || {}, changes = {}){
  if(!analyticsSlotsReady() || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return false;
  const patchAll = !Object.keys(changes || {}).length;
  const trendChangesChart = Boolean(changes.trend && trendListCanDriveChart(s, isDayRange()));
  const needsRows = patchAll || changes.summary || trendChangesChart || (analyticsAdvancedOpen && (changes.sourceStats || changes.modelStats || changes.sessionSummary));
  const rows = needsRows ? getFilteredRowsForView(s) : null;
  const started = perfNow();
  if(patchAll || changes.sourceStats || changes.modelStats) patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
  if(patchAll || changes.summary) patchHtmlSlot('analyticsSummarySlot', renderSummary(rows || getFilteredRowsForView(s), s));
  if(patchAll || trendChangesChart) patchChartChrome(rows || getFilteredRowsForView(s), s);
  if(patchAll || changes.sessionSummary) patchHtmlSlot('analyticsAgentSlot', renderAgentRhythm(s));
  if(analyticsAdvancedOpen && (patchAll || changes.sourceStats || changes.modelStats || changes.sessionSummary)){
    patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows || getFilteredRowsForView(s), s));
  }
  const domMs = perfNow() - started;
  markPerfStage('domCommitMs', domMs);
  if(!currentRenderPerf) recordPatchPerf('analytics:aggregate-patch', started, rows?.length || 0, { domCommitMs: Math.round(domMs) });
  if(patchAll || trendChangesChart){
    const chartRows = rows || getFilteredRowsForView(s);
    scheduleChartBind(chartRows, s, { instant: true, aggregate: true }, 220);
  }
  return true;
}
function updateLimitNote(kind, rendered, total){
  const note = document.querySelector(`[data-table-limit="${kind}"]`);
  if(!note) return;
  if(rendered >= total){ note.remove?.(); return; }
  note.dataset.rendered = String(rendered);
  note.dataset.total = String(total);
  if(kind === 'sessions' && note.classList?.contains?.('table-page-note')){
    const pageSize = SESSION_PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
    const page = Math.max(0, Math.min(totalPages - 1, Number(sessionTablePage || 0)));
    const displayCount = Number(rendered || 0) || Math.min(pageSize, Math.max(0, Number(total || 0) - page * pageSize));
    const start = page * pageSize + (displayCount ? 1 : 0);
    const end = Math.min(Number(total || 0), page * pageSize + displayCount);
    const span = note.querySelector('span');
    if(span) span.textContent = `${TXT.sessionPagination || '会话分页'}：${n(start)}-${n(end)} / ${n(total)} · ${TXT.page || '第'} ${n(page + 1)} / ${n(totalPages)}`;
    const prev = note.querySelector('[data-session-page="prev"]');
    const next = note.querySelector('[data-session-page="next"]');
    if(prev) prev.disabled = page <= 0;
    if(next) next.disabled = page >= totalPages - 1;
    return;
  }
  const suffix = kind === 'sessions'
    ? '\u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22 / \u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002'
    : '\u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22\u7f29\u5c0f\u8303\u56f4\u3002';
  note.textContent = `\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} ${suffix}`;
}
function currentPageRangePayload(){
  if(!snapshot?.ok) return {};
  return { start: sinceForRange(snapshot), end: untilForRange(snapshot) };
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
async function loadRequestPage(offset, limit = 100){
  if(requestPageLoading) return null;
  requestPageLoading = true;
  try {
    return await ipcRenderer.invoke('dashboard:getRequestsPage', {
      limit,
      offset,
      source: sourceFilter,
      model: modelFilter,
      range: currentPageRangePayload(),
      query: analyticsQuery,
    });
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
  if(!snapshot?.ok) return false;
  const tbody = document.querySelector('.request-main tbody');
  if(!tbody || typeof tbody.insertAdjacentHTML !== 'function') return render(snapshot, { windowLayout:false, instantChart:true, partial:true });
  const started = perfNow();
  const before = Math.max(100, Number(requestTableRenderLimit || 100));
  const paged = requestPageMatchesTable(snapshot);
  const rows = paged ? (snapshot.requestPage.items || []) : applyTableSearch(getFilteredRowsForView(snapshot));
  const totalRows = paged ? Number(snapshot.requestPage.total || rows.length) : rows.length;
  const next = Math.min(before + 100, rows.length, 5000);
  let chunkItems = rows.slice(before, next);
  let total = totalRows;
  let renderedNext = before + chunkItems.length;
  if(!chunkItems.length){
    const page = await loadRequestPage(before, 100);
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

function patchSessionInspector(){
  const started = perfNow();
  let t = started;
  const marks = { findMs: 0, commitMs: 0, selectMs: 0 };
  const slot = document.getElementById('sessionInspectorSlot');
  if(!slot) return false;
  const item = findSelectedSession();
  marks.findMs = Math.round(perfNow() - t); t = perfNow();
  if(!item){
    const html = `<aside class="session-inspector empty"><div class="inspector-title">${TXT.selectedSession}</div><p>${TXT.noSessionSelected}</p></aside>`;
    if(slotHtmlCache?.get('sessionInspectorSlot') !== html){
      try { lastCommittedHtml = ''; } catch {}
      slot.innerHTML = html;
      rememberSlotHtml('sessionInspectorSlot', html);
    }
  } else {
    selectedSessionId = sessionKeyFor(item);
    localStorage.setItem('selectedSessionId', selectedSessionId);
    if(!patchSessionInspectorInPlace(slot, item, selectedSessionId)){
      const html = renderSessionEssentialInspector(item, selectedSessionId);
      try { lastCommittedHtml = ''; } catch {}
      if(slotHtmlCache?.get('sessionInspectorSlot') !== html){
        slot.innerHTML = html;
        rememberSlotHtml('sessionInspectorSlot', html);
      }
    }
  }
  marks.commitMs = Math.round(perfNow() - t); t = perfNow();
  patchSessionSelectionChrome();
  marks.selectMs = Math.round(perfNow() - t);
  if(typeof recordPatchPerf === 'function') recordPatchPerf('sessions:inspector-patch', started, sessionTableItems?.length || 0, marks);
  return true;
}

function patchSessionInspectorInPlace(slot, item, key){
  const root = slot.querySelector?.('.session-essential-inspector');
  if(!root || root.classList?.contains?.('empty')) return false;
  const setText = (node, value) => { const text = String(value ?? ''); if(node && node.textContent !== text) node.textContent = text; };
  const setData = (node, name, value) => { if(node && node.dataset && node.dataset[name] !== String(value ?? '')) node.dataset[name] = String(value ?? ''); };
  const u = item.usage || {};
  const archived = Boolean(item.archived);
  const pinned = isPinnedSession(item);
  const meta = metaForSession(item);
  const title = root.querySelector('.session-essential-head h3');
  const id = root.querySelector('.session-essential-head p');
  setText(title, item.title || TXT.untitled);
  setText(id, item.id || '');
  const badges = root.querySelector('.session-badges');
  const badgeHtml = `<span class="session-state ${archived ? 'archived' : 'live'}">${archived ? TXT.archived : TXT.active}</span>${pinned ? `<span class="session-state pinned-state">${TXT.pinned}</span>` : ''}`;
  if(badges && badges.innerHTML !== badgeHtml) badges.innerHTML = badgeHtml;
  const metaValues = root.querySelectorAll('.session-essential-meta b');
  setText(metaValues[0], compact(u.total || 0));
  setText(metaValues[1], dateLabel(item.updatedAt));
  setText(metaValues[2], n(u.userTurns || 0));
  setText(metaValues[3], sessionTopModel(item));
  root.querySelectorAll('[data-session-key]').forEach((button) => { setData(button, 'sessionKey', key); });
  root.querySelectorAll('[data-session-pin]').forEach((button) => { setData(button, 'sessionPin', key); setText(button, pinned ? TXT.unpin : TXT.pin); });
  const archiveButton = root.querySelector('[data-session-action="archive"]');
  if(archiveButton){ setData(archiveButton, 'sessionKey', key); setData(archiveButton, 'archive', archived ? 'false' : 'true'); setText(archiveButton, archived ? TXT.restore : TXT.archive); }
  const tagsPreview = root.querySelector('.session-tags-preview');
  const tagsHtml = sessionTagsHtml(item, 6);
  if(tagsPreview && tagsPreview.innerHTML !== tagsHtml) tagsPreview.innerHTML = tagsHtml;
  const tags = root.querySelector('[data-session-tags]');
  if(tags){ setData(tags, 'sessionTags', key); const nextTags = (meta.tags || []).join(', '); if(tags.value !== nextTags) tags.value = nextTags; }
  const note = root.querySelector('[data-session-note]');
  if(note){ setData(note, 'sessionNote', key); const nextNote = meta.note || ''; if(note.value !== nextNote) note.value = nextNote; }
  const code = root.querySelector('.session-essential-foot code');
  if(code){ const titleText = item.directory || ''; if(code.title !== titleText) code.title = titleText; setText(code, item.directory ? compactPath(item.directory) : emptyMetric()); }
  return true;
}


function captureSessionDomState(){
  const active = document.activeElement;
  const query = active?.matches?.('[data-query="sessions"]') ? {
    start: active.selectionStart,
    end: active.selectionEnd,
  } : null;
  const scroll = document.querySelector('.session-scroll');
  const app = document.getElementById('app');
  return {
    query,
    scrollTop: Number(scroll?.scrollTop || 0),
    scrollLeft: Number(scroll?.scrollLeft || 0),
    appScrollTop: Number(app?.scrollTop || 0),
    appScrollLeft: Number(app?.scrollLeft || 0),
  };
}
function restoreSessionDomState(state = {}){
  if(state.query){
    const q = document.querySelector('[data-query="sessions"]');
    if(q){
      q.focus?.();
      try { q.setSelectionRange(state.query.start ?? q.value.length, state.query.end ?? q.value.length); } catch {}
    }
  }
  const scroll = document.querySelector('.session-scroll');
  const app = document.getElementById('app');
  const apply = () => {
    if(scroll){
      scroll.scrollTop = state.scrollTop || 0;
      scroll.scrollLeft = state.scrollLeft || 0;
    }
    if(app){
      app.scrollTop = state.appScrollTop || 0;
      app.scrollLeft = state.appScrollLeft || 0;
    }
  };
  apply();
  if(typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  setTimeout(apply, 40);
  setTimeout(apply, 120);
}
function replaceSessionTableFromHtml(managerHtml){
  const slot = document.getElementById('sessionTableSlot');
  if(!slot || !document.createElement) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = managerHtml;
  const next = tmp.querySelector?.('#sessionTableSlot');
  if(!next) return false;
  const html = next.innerHTML;
  if(slotHtmlCache?.get(slot.id) === html) return true;
  try { lastCommittedHtml = ''; } catch {}
  slot.innerHTML = html;
  rememberSlotHtml(slot.id, html);
  return true;
}
function replaceSessionInspectorFromHtml(managerHtml){
  const slot = document.getElementById('sessionInspectorSlot');
  if(!slot || !document.createElement) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = managerHtml;
  const next = tmp.querySelector?.('#sessionInspectorSlot');
  if(!next) return false;
  const html = next.innerHTML;
  try { lastCommittedHtml = ''; } catch {}
  slot.innerHTML = html;
  rememberSlotHtml(slot.id, html);
  return true;
}
function patchSessionBulk(){
  const slot = document.getElementById('sessionBulkSlot');
  if(!slot) return false;
  const selected = selectedSessionItems();
  const simple = !sessionAdvancedOpen;
  const existingSimple = simple ? slot.querySelector?.('.session-bulk.simple') : null;
  if(existingSimple){
    existingSimple.classList.toggle('empty', !selected.length);
    const label = existingSimple.querySelector('span');
    if(label) label.textContent = `${TXT.selected} ${n(selected.length)}`;
    existingSimple.querySelectorAll('button').forEach((button) => {
      const action = button?.dataset?.sessionBulk;
      if(action && action !== 'select-all') button.disabled = !selected.length;
    });
    const rowCount = document.querySelector('.session-toolbar .row-count');
    if(rowCount) rowCount.textContent = `${n(sessionTableItems.length)} ${TXT.rows}`;
    return true;
  }
  const html = sessionBulkHtml(false);
  try { lastCommittedHtml = ''; } catch {}
  slot.innerHTML = html;
  rememberSlotHtml('sessionBulkSlot', html);
  const rowCount = document.querySelector('.session-toolbar .row-count');
  if(rowCount) rowCount.textContent = `${n(sessionTableItems.length)} ${TXT.rows}`;
  return true;
}
function patchSessionOverview(s = snapshot || {}){
  return patchHtmlSlot('sessionOverviewSlot', sessionOverviewHtml(s));
}
function patchSessionToolbar(s = snapshot || {}){
  return patchHtmlSlot('sessionToolbarSlot', `${sessionSimpleToolbarHtml(s)}${sessionFilterContextHtml(s)}${sessionAdvancedHtml(s)}`);
}
function patchSessionModal(){
  return patchHtmlSlot('sessionModalSlot', `${renderRenameSheet()}${renderBulkMetaSheet()}`);
}
function patchSessionRow(key){
  if(typeof document.querySelectorAll !== 'function') return false;
  const item = sessionByKey(key);
  if(!item) return false;
  let patched = false;
  document.querySelectorAll('.session-row').forEach((row) => {
    if(row?.dataset?.sessionSelect !== key) return;
    row.outerHTML = sessionRowHtml(item, false);
    patched = true;
  });
  return patched;
}
function sessionAttrSelectorValue(value){
  const raw = String(value || '');
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}
function scheduleSessionBulkPatch(){
  if(sessionBulkPatchFrame) return true;
  const token = {};
  const run = () => {
    if(sessionBulkPatchFrame !== token) return;
    sessionBulkPatchFrame = null;
    patchSessionBulk();
  };
  sessionBulkPatchFrame = token;
  if(typeof requestAnimationFrame === 'function'){
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
  setTimeout(run, 80);
  return true;
}
function patchSingleSessionCheckbox(key){
  if(!key || typeof document.querySelector !== 'function') return false;
  let patched = false;
  const input = document.querySelector(`[data-session-check="${sessionAttrSelectorValue(key)}"]`);
  if(input){
    const checked = selectedSessionKeys.has(key);
    if(input.checked !== checked) input.checked = checked;
    patched = true;
  }
  const all = sessionTableItems.map(sessionKeyFor);
  const allBox = document.querySelector('[data-session-check-all]');
  if(allBox) allBox.checked = Boolean(all.length && all.every((itemKey) => selectedSessionKeys.has(itemKey)));
  scheduleSessionBulkPatch();
  return patched || Boolean(allBox);
}
function patchSessionCheckboxes(keys = null){
  if(typeof document.querySelectorAll !== 'function') return false;
  const limit = keys instanceof Set ? keys : null;
  if(limit && limit.size === 1) return patchSingleSessionCheckbox([...limit][0]);
  const state = captureSessionDomState();
  let patched = false;
  document.querySelectorAll('[data-session-check]').forEach((input) => {
    const key = input?.dataset?.sessionCheck;
    if(!key || (limit && !limit.has(key))) return;
    const checked = selectedSessionKeys.has(key);
    if(input.checked !== checked) input.checked = checked;
    patched = true;
  });
  const all = sessionTableItems.map(sessionKeyFor);
  const allBox = document.querySelector('[data-session-check-all]');
  if(allBox) allBox.checked = Boolean(all.length && all.every((key) => selectedSessionKeys.has(key)));
  patchSessionBulk();
  restoreSessionDomState(state);
  return patched || Boolean(allBox);
}
function patchSessionVisibleRows(){
  if(!Array.isArray(sessionTableItems) || !sessionTableItems.length) return false;
  let patched = false;
  for(const item of sessionTableItems) patched = patchSessionRow(sessionKeyFor(item)) || patched;
  patchSessionBulk();
  return patched;
}
function sessionRowForKey(key){
  if(!key || typeof document.querySelector !== 'function') return null;
  try { return document.querySelector(`[data-session-select="${sessionAttrSelectorValue(key)}"]`); }
  catch { return null; }
}
function patchSessionSelectionChrome(nextRow = null){
  if(typeof document.querySelector !== 'function') return false;
  const key = selectedSessionId || '';
  if(lastSessionSelectedRowKey && lastSessionSelectedRowKey !== key){
    const prev = sessionRowForKey(lastSessionSelectedRowKey);
    if(prev?.classList?.contains?.('selected')) prev.classList.remove('selected');
  }
  document.querySelectorAll?.('.session-row.selected')?.forEach?.((row) => {
    if(row?.dataset?.sessionSelect !== key) row.classList.remove('selected');
  });
  let row = nextRow?.dataset?.sessionSelect === key ? nextRow : sessionRowForKey(key);
  if(row && !row.classList.contains('selected')) row.classList.add('selected');
  lastSessionSelectedRowKey = key;
  return Boolean(row);
}
function scheduleSessionInspectorPatch(delay = 16){
  const token = ++sessionInspectorPatchToken;
  if(sessionInspectorPatchTimer) clearTimeout(sessionInspectorPatchTimer);
  const run = () => {
    if(token !== sessionInspectorPatchToken || workspaceMode !== 'sessions') return;
    sessionInspectorPatchTimer = null;
    const commit = () => {
      if(token !== sessionInspectorPatchToken || workspaceMode !== 'sessions') return;
      patchSessionInspector();
    };
    if(typeof requestIdleCallback === 'function') requestIdleCallback(commit, { timeout: 120 });
    else if(typeof requestAnimationFrame === 'function') requestAnimationFrame(commit);
    else setTimeout(commit, 0);
  };
  sessionInspectorPatchTimer = setTimeout(run, Math.max(0, Number(delay || 0)));
  return true;
}
function patchSessionView(s = snapshot || {}, opts = {}){
  if(!document.createElement) return false;
  if(!document.getElementById('sessionOverviewSlot') || !document.getElementById('sessionTableSlot')) return false;
  const started = perfNow();
  const state = captureSessionDomState();
  const preserveScroll = opts.pageChange !== true;
  const table = opts.table !== false;
  const toolbar = opts.toolbar !== false;
  const inspector = opts.inspector !== false;
  const overview = opts.overview !== false;
  let managerHtml = '';
  if(table) managerHtml = sessionTable(s, { deferRows: opts.deferRows === true || opts.pageChange === true });
  if(overview) patchSessionOverview(s);
  if(toolbar) patchSessionToolbar(s);
  if(table) replaceSessionTableFromHtml(managerHtml);
  if(inspector){
    if(table) replaceSessionInspectorFromHtml(managerHtml);
    else patchSessionInspector();
  }
  patchSessionBulk();
  patchSessionModal();
  if(preserveScroll) restoreSessionDomState(state);
  else {
    const resetPageScroll = () => {
      const scroll = document.querySelector('.session-scroll');
      if(scroll){ scroll.scrollTop = 0; scroll.scrollLeft = 0; }
    };
    resetPageScroll();
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(resetPageScroll);
  }
  bindIncrementalTables();
  if(table && managerHtml.includes('data-session-deferred="1"') && typeof hydrateSessionRows === 'function') hydrateSessionRows();
  const domMs = perfNow() - started;
  markPerfStage('domCommitMs', domMs);
  if(!currentRenderPerf) recordPatchPerf('sessions:slots-patch', started, sessionTableItems.length, { domCommitMs: Math.round(domMs) });
  return true;
}
function patchSessionAfterLocalMutation(key, opts = {}){
  if(typeof document.querySelectorAll !== 'function') return false;
  const state = captureSessionDomState();
  const s = snapshot || {};
  if(opts.table) return patchSessionView(s, { table: true, toolbar: true, inspector: true });
  patchSessionOverview(s);
  patchSessionToolbar(s);
  patchSessionRow(key);
  patchSessionInspector();
  patchSessionBulk();
  patchSessionModal();
  restoreSessionDomState(state);
  return true;
}

function perfPanelHtml(){
  const p = lastRenderPerf || {};
  return `<div id="perfPanel" class="perf-panel ${perfPanelOpen ? 'show' : ''}"><b>渲染性能</b><span>总耗时 ${p.totalMs ?? '-'}ms</span><span>筛选 ${p.filterMs ?? 0}ms</span><span>图表 ${p.chartDrawMs ?? 0}ms</span><span>Canvas ${p.chartCanvasMs ?? 0}ms</span><span>布局读取 ${p.chartLayoutReadMs ?? 0}ms</span><span>DOM ${p.domCommitMs ?? 0}ms</span><span>表格 ${p.tableRenderMs ?? 0}ms</span><span>下方区域 ${p.lowerRenderMs ?? 0}ms</span><em>${esc(p.label || viewModeKey())}</em></div>`;
}
function updatePerfPanel(){
  let panel = document.getElementById('perfPanel');
  if(!perfPanelOpen){ panel?.remove?.(); return; }
  if(!panel){ document.body?.insertAdjacentHTML?.('beforeend', perfPanelHtml()); return; }
  panel.outerHTML = perfPanelHtml();
}
function togglePerfPanel(){
  perfPanelOpen = !perfPanelOpen;
  localStorage.setItem('perfPanelOpen', perfPanelOpen ? '1' : '0');
  updatePerfPanel();
}
