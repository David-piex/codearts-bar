async function handleDashboardAnalyticsClick(e){
    const requestSelect = e.target.closest('[data-request-select]');
    if(requestSelect){
      selectedRequestKey = requestSelect.dataset.requestSelect;
      localStorage.setItem('selectedRequestKey', selectedRequestKey);
      if(requestSelect.dataset.table){
        tableTab = requestSelect.dataset.table;
        localStorage.setItem('statsTableTab', tableTab);
        layoutMode = 'dashboard';
        localStorage.setItem('layoutMode', layoutMode);
        if(snapshot?.ok && patchAnalyticsSlotsForState(snapshot, { tableOnly: true })) throw DASHBOARD_EVENT_HANDLED;
      }
      if(patchRequestSelection()) throw DASHBOARD_EVENT_HANDLED;
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const requestAction = e.target.closest('[data-request-action]');
    if(requestAction){
      const item = requestByKey(requestAction.dataset.requestKey);
      if(!item) throw DASHBOARD_EVENT_HANDLED;
      if(requestAction.dataset.requestAction === 'copy-json') await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
      if(requestAction.dataset.requestAction === 'copy-session') await navigator.clipboard.writeText(item.sessionId || '');
      if(requestAction.dataset.requestAction === 'view-session'){
        tableTab = 'sessions';
        selectedSessionId = `${sourceKey(item)}:${item.sessionId || ''}`;
        sessionQuery = item.sessionId || '';
        resetSessionPaging();
        workspaceMode = 'sessions';
        localStorage.setItem('workspaceMode', workspaceMode);
        localStorage.setItem('statsTableTab', tableTab);
        localStorage.setItem('selectedSessionId', selectedSessionId);
        localStorage.setItem('statsSessionQuery', sessionQuery);
        if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
        throw DASHBOARD_EVENT_HANDLED;
      }
      setRefreshState(TXT.copied);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
      throw DASHBOARD_EVENT_HANDLED;
    }
    const series = e.target.closest('[data-series]');
    if(series){ const key = series.dataset.series; if(visibleSeries.has(key)) visibleSeries.delete(key); else visibleSeries.add(key); saveVisibleSeries(); if(snapshot?.ok && patchAnalyticsChartOnly(snapshot)) throw DASHBOARD_EVENT_HANDLED; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; }
    const cacheModel = e.target.closest('[data-cache-model]');
    if(cacheModel){ resetIncrementalRenderLimits('all'); modelFilter = cacheModel.dataset.cacheModel || 'all'; localStorage.setItem('statsModel', modelFilter); if(snapshot?.ok && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) throw DASHBOARD_EVENT_HANDLED; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; }
    const cacheProject = e.target.closest('[data-cache-project]');
    if(cacheProject){
      workspaceMode = 'sessions';
      sessionProjectFilter = cacheProject.dataset.cacheProject || 'all';
      sessionQuickFilter = 'cacheLow';
      sessionStatusFilter = 'all';
      tableTab = 'sessions';
      resetSessionPaging();
      localStorage.setItem('workspaceMode', workspaceMode);
      localStorage.setItem('sessionProjectFilter', sessionProjectFilter);
      localStorage.setItem('sessionQuickFilter', sessionQuickFilter);
      localStorage.setItem('sessionStatusFilter', sessionStatusFilter);
      localStorage.setItem('statsTableTab', tableTab);
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const src = e.target.closest('[data-source]');
    const rangeApply = e.target.closest('[data-range-apply]');
    const tab = e.target.closest('[data-table]');
    if(rangeApply){ applyCustomDateInputs(); if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) throw DASHBOARD_EVENT_HANDLED; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; }
    if(src){ resetIncrementalRenderLimits('all'); resetSessionPaging(); sourceFilter = src.dataset.source; localStorage.setItem('statsSource', sourceFilter); if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) throw DASHBOARD_EVENT_HANDLED; if(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, { table: true, toolbar: false, inspector: true })) throw DASHBOARD_EVENT_HANDLED; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; }
    if(tab){ resetIncrementalRenderLimits('all'); const previousWorkspace = workspaceMode; tableTab = tab.dataset.table; localStorage.setItem('statsTableTab', tableTab); if(tableTab === 'sessions'){ workspaceMode = 'sessions'; resetSessionPaging(); localStorage.setItem('workspaceMode', workspaceMode); } else { workspaceMode = 'analytics'; localStorage.setItem('workspaceMode', workspaceMode); } const workspaceChanged = previousWorkspace !== workspaceMode; if(workspaceChanged){ document.getElementById('app')?.classList?.add?.('view-switching'); setAppInteractionMode('view-switching', 200); } if(tab.closest('.compact-panel-actions')){ layoutMode = 'dashboard'; localStorage.setItem('layoutMode', layoutMode); } if(snapshot?.ok && workspaceMode === 'analytics' && !workspaceChanged && patchAnalyticsSlotsForState(snapshot, { tableOnly: true })) throw DASHBOARD_EVENT_HANDLED; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true, deferHeavy: workspaceMode === 'analytics' && workspaceChanged && typeof ResizeObserver !== 'undefined' }); throw DASHBOARD_EVENT_HANDLED; }
  return false;
}
