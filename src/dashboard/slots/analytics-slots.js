function analyticsTableHtml(rows, s){ const t = perfNow(); const html = renderTable(rows, s); markPerfStage('lowerRenderMs', perfNow() - t); return html; }
function analyticsAdvancedHtml(rows, s){ const t = perfNow(); const html = renderAnalyticsAdvanced(rows, s); markPerfStage('lowerRenderMs', perfNow() - t); return html; }
function analyticsDeferredHtml(label = TXT.updatingDetails || '正在更新明细...'){
  return `<div class="analytics-deferred"><span>${esc(label)}</span></div>`;
}
function cancelAnalyticsDeferredPatches(){
  for(const task of analyticsDeferredTasks || []) if(task?.timer != null) clearTimeout(task.timer);
  try { analyticsDeferredTasks?.clear?.(); } catch {}
}
function scheduleAnalyticsDeferredPatches(token, rows, s, opts = {}){
  cancelAnalyticsDeferredPatches();
  const stillValid = () => token === analyticsDeferredToken && snapshot === s && layoutMode === 'dashboard' && workspaceMode === 'analytics';
  const schedule = (delay, fn) => {
    const task = { timer: null };
    analyticsDeferredTasks?.add?.(task);
    task.timer = setTimeout(() => {
      analyticsDeferredTasks?.delete?.(task);
      if(!stillValid()) return;
      fn();
    }, delay);
  };
  if(opts.skipAgent !== true) schedule(16, () => patchHtmlSlot('analyticsAgentSlot', renderAgentRhythm(s)));
  if(opts.skipTable !== true){
    schedule(72, () => {
      patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
      bindIncrementalTables();
    });
  }
  if(opts.skipAdvanced !== true){
    schedule(180, () => {
      patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
      bindIncrementalTables();
    });
  }
}
function analyticsShellHtml(s, rows, opts = {}){
  const deferHeavy = opts.deferHeavy === true;
  const tableHtml = deferHeavy ? analyticsDeferredHtml(TXT.updatingDetails || '正在更新明细...') : analyticsTableHtml(rows, s);
  const advancedHtml = deferHeavy ? '' : analyticsAdvancedHtml(rows, s);
  const agentHtml = deferHeavy ? analyticsDeferredHtml(TXT.updatingAgentIdle || '正在更新 Agent idle...') : renderAgentRhythm(s);
  return `${headerHtml(false)}<div id="analyticsFiltersSlot">${filtersHtml(s)}</div><div id="analyticsSummarySlot">${renderSummary(rows, s)}</div><div id="analyticsEmptySlot">${analyticsEmptyState(rows)}</div><div id="analyticsChartSlot">${renderChart(rows, s)}</div><div id="analyticsAgentSlot">${agentHtml}</div><div id="analyticsTableSlot">${tableHtml}</div><div id="analyticsAdvancedSlot">${advancedHtml}</div><div id="analyticsDiagnosticsSlot">${renderDiagnosticsNotice(s)}</div>`;
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
  const preserveDatePopover = opts.preserveFilters === true || Boolean(dateRangeOpen && document.querySelector?.('.date-range-popover'));
  if(!preserveDatePopover) patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
  patchHtmlSlot('analyticsSummarySlot', renderSummary(rows, s));
  patchHtmlSlot('analyticsDiagnosticsSlot', renderDiagnosticsNotice(s));
  patchHtmlSlot('analyticsEmptySlot', analyticsEmptyState(rows));
  patchChartChrome(rows, s);
  const token = ++analyticsDeferredToken;
  cancelAnalyticsDeferredPatches();
  if(opts.deferHeavy === true){
    patchHtmlSlot('analyticsAgentSlot', analyticsDeferredHtml(TXT.updatingAgentIdle || '正在更新 Agent idle...'));
    if(opts.sourceSwitch === true){
      patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
      bindIncrementalTables();
    } else {
      patchHtmlSlot('analyticsTableSlot', analyticsDeferredHtml(TXT.updatingDetails || '正在更新明细...'));
    }
    patchHtmlSlot('analyticsAdvancedSlot', '');
    scheduleAnalyticsDeferredPatches(token, rows, s, {
      skipTable: opts.sourceSwitch === true,
      skipAdvanced: opts.sourceSwitch === true && !analyticsAdvancedOpen,
    });
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
function cancelScheduledChartBind(invalidate = true){
  if(invalidate) chartBindToken += 1;
  if(chartBindTimer) clearTimeout(chartBindTimer);
  if(chartBindFrame) cancelAnimationFrame(chartBindFrame);
  if(chartBindIdle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(chartBindIdle);
  if(chartBindFallbackTimer) clearTimeout(chartBindFallbackTimer);
  chartBindTimer = null;
  chartBindFrame = null;
  chartBindIdle = null;
  chartBindFallbackTimer = null;
}
function scheduleChartBind(rows, s, opts = {}, delay = 42, after = null){
  cancelScheduledChartBind(false);
  const token = ++chartBindToken;
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
    const preferIdleBind = opts.settled === true ? false : (opts.resize === true || delay > 80);
    if(preferIdleBind && typeof requestIdleCallback === 'function'){
      chartBindIdle = requestIdleCallback(() => {
        chartBindIdle = null;
        commit();
      }, { timeout: opts.resize === true ? 900 : 700 });
      return;
    }
    if(preferIdleBind){
      chartBindFallbackTimer = setTimeout(() => {
        chartBindFallbackTimer = null;
        commit();
      }, opts.resize === true ? 120 : 80);
      return;
    }
    let bound = false;
    const bindNow = () => {
      if(bound) return;
      bound = true;
      if(chartBindFrame){ try { cancelAnimationFrame(chartBindFrame); } catch {} }
      if(chartBindFallbackTimer) clearTimeout(chartBindFallbackTimer);
      chartBindFrame = null;
      chartBindFallbackTimer = null;
      if(token !== chartBindToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
      bindChart(rows, s, opts);
      if(typeof ensureChartResizeObserver === 'function') ensureChartResizeObserver();
      if(typeof after === 'function') after();
    };
    chartBindFrame = requestAnimationFrame(bindNow);
    chartBindFallbackTimer = setTimeout(bindNow, 48);
    try { Promise.resolve().then(bindNow); } catch {}
  }, Math.max(0, Number(delay || 0)));
}
function patchAnalyticsSlotsForState(s = snapshot || {}, opts = {}){
  if(!analyticsSlotsReady() || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return false;
  const started = perfNow();
  const rows = currentAnalyticsRows(s);
  if(opts.tableOnly === true){
    if(tableTab === 'requests' && typeof patchRequestTablePageRows === 'function' && patchRequestTablePageRows(s)){
      if(!currentRenderPerf) recordPatchPerf('analytics:request-page-patch', started, rows.length, { domCommitMs: Math.round(perfNow() - started) });
      return true;
    }
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
  if(!currentRenderPerf) recordPatchPerf(opts.sourceSwitch === true ? 'analytics:source-switch-patch' : 'analytics:slots-patch', started, rows.length, { domCommitMs: Math.round(perfNow() - started) });
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
  if(dateRangeOpen && document.querySelector?.('.date-range-popover')) return true;
  return patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
}
function currentRequestTableList(rows = currentAnalyticsRows(snapshot || {})){
  const data = typeof requestTableData === 'function' ? requestTableData(rows, snapshot || {}) : null;
  if(data && Array.isArray(data.list)) return data.list;
  const matched = applyTableSearch(rows);
  const start = Math.max(0, Number(requestTablePage || 0)) * REQUEST_PAGE_SIZE;
  return matched.slice(start, start + REQUEST_PAGE_SIZE);
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
  setInteractionMode('is-filtering', 190);
  const preserveDatePopover = Boolean(dateRangeOpen && document.querySelector?.('.date-range-popover'));
  const patchAll = !Object.keys(changes || {}).length;
  const trendChangesChart = Boolean(changes.trend && trendListCanDriveChart(s, isDayRange()));
  const needsRows = patchAll || changes.summary || trendChangesChart || (analyticsAdvancedOpen && (changes.sourceStats || changes.modelStats || changes.sessionSummary));
  const rows = needsRows ? getFilteredRowsForView(s) : null;
  const started = perfNow();
  if(!preserveDatePopover && (patchAll || changes.sourceStats || changes.modelStats)) patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
  if(patchAll || changes.summary) patchHtmlSlot('analyticsSummarySlot', renderSummary(rows || getFilteredRowsForView(s), s));
  if(patchAll || changes.summary || changes.sourceStats) patchHtmlSlot('analyticsDiagnosticsSlot', renderDiagnosticsNotice(s));
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
