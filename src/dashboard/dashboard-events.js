function patchSessionsOrRender(opts = {}){
  if(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, opts)) return true;
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
  return false;
}
function patchSessionModalOrRender(){
  const hasModalSlot = typeof document.querySelector === 'function' ? Boolean(document.querySelector('#sessionModalSlot')) : false;
  if(snapshot?.ok && workspaceMode === 'sessions' && hasModalSlot && patchSessionModal()) return true;
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: false });
  return false;
}
document.addEventListener('click', async (e) => {
  if(e.__dashboardHandled) return;
  const refreshButton = e.target.closest('[data-refresh]');
  if(refreshButton){ await refreshNow({ windowLayout: false, instantChart: true, partial: true }); return; }
  const openLogs = e.target.closest('[data-open-logs]');
  if(openLogs){ await ipcRenderer.invoke('dashboard:openLogs'); return; }
  const layoutModeBtn = e.target.closest('[data-layout-mode]');
  if(layoutModeBtn){
    switchLayoutMode(layoutModeBtn.dataset.layoutMode);
    return;
  }
  const compactPaneBtn = e.target.closest('[data-compact-pane]');
  if(compactPaneBtn){
    compactPane = compactPaneBtn.dataset.compactPane || 'overview';
    localStorage.setItem('compactPane', compactPane);
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
    return;
  }
  const compactPin = e.target.closest('[data-compact-pin]');
  if(compactPin){
    compactPinned = !compactPinned;
    localStorage.setItem('compactPinned', compactPinned ? '1' : '0');
    applyCompactWindowChrome();
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
    return;
  }
  const bulkMetaCancel = e.target.closest('[data-bulk-meta-cancel]');
  const bulkMetaBackdrop = e.target?.dataset?.modalBackdrop === 'bulk-meta';
  if(bulkMetaCancel || bulkMetaBackdrop){
    bulkMetaOpen = false;
    bulkMetaTagsDraft = '';
    bulkMetaNoteDraft = '';
    patchSessionModalOrRender();
    return;
  }
  const bulkMetaSave = e.target.closest('[data-bulk-meta-save]');
  if(bulkMetaSave){ saveBulkMetaSheet(); return; }
  const renameCancel = e.target.closest('[data-rename-cancel]');
  const renameBackdrop = e.target?.dataset?.modalBackdrop === 'rename';
  if(renameCancel || renameBackdrop){
    renameSessionKey = '';
    renameDraft = '';
    patchSessionModalOrRender();
    return;
  }
  const renameSave = e.target.closest('[data-rename-save]');
  if(renameSave){ await saveRenameSheet(); return; }
  const workspace = e.target.closest('[data-workspace]');
  if(workspace){
    const nextWorkspace = workspace.dataset.workspace || 'analytics';
    const changed = workspaceMode !== nextWorkspace;
    workspaceMode = nextWorkspace;
    localStorage.setItem('workspaceMode', workspaceMode);
    if(workspaceMode === 'sessions'){ tableTab = 'sessions'; localStorage.setItem('statsTableTab', tableTab); }
    else if(tableTab === 'sessions'){ tableTab = 'requests'; localStorage.setItem('statsTableTab', tableTab); }
    if(changed){
      document.getElementById('app')?.classList?.add?.('view-switching');
      setAppInteractionMode('view-switching', 200);
    }
    const canDeferWorkspace = workspaceMode === 'analytics' && changed && typeof ResizeObserver !== 'undefined';
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true, deferHeavy: canDeferWorkspace });
    return;
  }
  const smartView = e.target.closest('[data-session-smart-view]');
  if(smartView){ applySessionSmartView(smartView.dataset.sessionSmartView || 'recent'); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); return; }
  const saveView = e.target.closest('[data-saved-session-save]');
  if(saveView){
    saveCurrentSessionView();
    setRefreshState(TXT.savedLocal);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false });
    return;
  }
  const applySavedView = e.target.closest('[data-saved-session-apply]');
  if(applySavedView){
    const view = savedSessionViews.find((x) => x.id === applySavedView.dataset.savedSessionApply);
    applySavedSessionView(view);
    setRefreshState(TXT.savedViewApplied);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true });
    return;
  }
  const deleteSavedView = e.target.closest('[data-saved-session-delete]');
  if(deleteSavedView){
    savedSessionViews = savedSessionViews.filter((x) => x.id !== deleteSavedView.dataset.savedSessionDelete);
    saveSavedSessionViews();
    setRefreshState(TXT.savedViewDeleted);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false });
    return;
  }
  const advancedToggle = e.target.closest('[data-session-advanced-toggle]');
  if(advancedToggle){
    sessionAdvancedOpen = !sessionAdvancedOpen;
    localStorage.setItem('sessionAdvancedOpen', sessionAdvancedOpen ? '1' : '0');
    patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false });
    return;
  }
  const analyticsAdvancedToggle = e.target.closest('[data-analytics-advanced-toggle]');
  if(analyticsAdvancedToggle){
    analyticsAdvancedOpen = !analyticsAdvancedOpen;
    localStorage.setItem('analyticsAdvancedOpen', analyticsAdvancedOpen ? '1' : '0');
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
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
    resetSessionPaging();
    saveSessionViewState();
    patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true });
    return;
  }
  const quick = e.target.closest('[data-session-quick]');
  if(quick){ sessionQuickFilter = quick.dataset.sessionQuick || 'all'; resetSessionPaging(); localStorage.setItem('sessionQuickFilter', sessionQuickFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); return; }
  const project = e.target.closest('[data-session-project]');
  if(project){ sessionProjectFilter = project.dataset.sessionProject || 'all'; resetSessionPaging(); localStorage.setItem('sessionProjectFilter', sessionProjectFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); return; }
  const resetSessionFilters = e.target.closest('[data-session-reset-filters]');
  if(resetSessionFilters){
    sessionQuickFilter = 'all';
    sessionProjectFilter = 'all';
    sessionStatusFilter = 'active';
    sessionSort = 'updated';
    sessionTagFilter = 'all';
    sessionQuery = '';
    resetSessionPaging();
    saveSessionViewState();
    patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true });
    return;
  }
  const cacheGovernance = e.target.closest('[data-session-cache-governance]');
  if(cacheGovernance){
    const action = cacheGovernance.dataset.sessionCacheGovernance;
    if(action === 'focus'){
      sessionQuickFilter = 'cacheLow';
      sessionStatusFilter = 'active';
      sessionSort = 'opportunity';
      resetSessionPaging();
      saveSessionViewState();
      patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true });
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
  const sessionPage = e.target.closest('[data-session-page]');
  if(sessionPage){
    const total = Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.total || 0);
    const maxPage = Math.max(0, Math.ceil(total / SESSION_PAGE_SIZE) - 1);
    sessionTablePage += sessionPage.dataset.sessionPage === 'next' ? 1 : -1;
    sessionTablePage = Math.max(0, Math.min(maxPage, sessionTablePage));
    localStorage.setItem('sessionTablePage', String(sessionTablePage));
    if(workspaceMode === 'sessions'){
      if(canUseDbSessionPage()) await refreshSessionPageCache(sessionTablePage, { force: true });
      if(patchSessionView(snapshot, { table: true, toolbar: false, inspector: true, pageChange: true })) return;
    }
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
    return;
  }
  const checkAll = e.target.closest('[data-session-check-all]');
  if(checkAll){
    const domState = captureSessionDomState();
    const all = sessionTableItems.map(sessionKeyFor);
    const allSelected = all.length && all.every((k) => selectedSessionKeys.has(k));
    if(allSelected) all.forEach((k) => selectedSessionKeys.delete(k));
    else all.forEach((k) => selectedSessionKeys.add(k));
    saveSelectedSessions();
    if(workspaceMode === 'sessions' && patchSessionCheckboxes()){ restoreSessionDomState(domState); return; }
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
    return;
  }
  const check = e.target.closest('[data-session-check]');
  if(check){
    const key = check.dataset.sessionCheck;
    if(selectedSessionKeys.has(key)) selectedSessionKeys.delete(key); else selectedSessionKeys.add(key);
    saveSelectedSessions();
    if(workspaceMode === 'sessions'){
      patchSessionCheckboxes(new Set([key]));
      return;
    }
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
    return;
  }
  const pin = e.target.closest('[data-session-pin]');
  if(pin){
    const key = pin.dataset.sessionPin;
    if(pinnedSessionKeys.has(key)) pinnedSessionKeys.delete(key); else pinnedSessionKeys.add(key);
    savePinnedSessions();
    if(workspaceMode === 'sessions' && patchSessionAfterLocalMutation(key, { table: sessionQuickFilter === 'pinned' })) return;
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
    return;
  }
  const bulk = e.target.closest('[data-session-bulk]');
  if(bulk){
    const action = bulk.dataset.sessionBulk;
    const items = selectedSessionItems();
    if(action === 'select-all'){
      sessionTableItems.forEach((item) => selectedSessionKeys.add(sessionKeyFor(item)));
      saveSelectedSessions();
      if(workspaceMode === 'sessions' && patchSessionCheckboxes()) return;
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      return;
    }
    if(action === 'clear'){
      selectedSessionKeys.clear();
      saveSelectedSessions();
      if(workspaceMode === 'sessions' && patchSessionCheckboxes()) return;
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      return;
    }
    if(!items.length) return;
    if(action === 'tag'){
      bulkMetaOpen = true;
      bulkMetaTagsDraft = '';
      bulkMetaNoteDraft = '';
      patchSessionModalOrRender();
      requestAnimationFrame(() => document.querySelector('[data-bulk-meta-tags]')?.focus());
      return;
    }
    if(action === 'copy-summary') await navigator.clipboard.writeText(items.map(sessionSummaryText).join('\n\n---\n\n'));
    if(action === 'copy-markdown') await navigator.clipboard.writeText(items.map(sessionMarkdown).join('\n\n---\n\n'));
    if(action === 'copy-json') await navigator.clipboard.writeText(JSON.stringify(items, null, 2));
    if(action === 'copy-csv') await navigator.clipboard.writeText(sessionCsv(items));
    if(action === 'archive' || action === 'restore'){
      setRefreshState(TXT.refresh);
      const nextArchived = action === 'archive';
      for(const item of items){ item.archived = nextArchived; item.archivedAt = nextArchived ? Date.now() : null; }
      selectedSessionKeys.clear();
      saveSelectedSessions();
      if(workspaceMode === 'sessions') patchSessionView(snapshot, { table: true, toolbar: false, inspector: true });
      await Promise.all(items.map((item) => ipcRenderer.invoke('dashboard:archiveSession', item, nextArchived)));
      await refreshNow({ windowLayout: false, instantChart: true, partial: true });
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
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      return;
    }
    if(action.dataset.sessionAction === 'open') await ipcRenderer.invoke('dashboard:openSession', item);
    if(action.dataset.sessionAction === 'open-codearts') await ipcRenderer.invoke('dashboard:openCodeArtsSession', item);
    if(action.dataset.sessionAction === 'rename'){
      renameSessionKey = key;
      renameDraft = item.title || '';
      patchSessionModalOrRender();
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
      const nextArchived = action.dataset.archive !== 'false';
      item.archived = nextArchived;
      item.archivedAt = nextArchived ? Date.now() : null;
      if(workspaceMode === 'sessions') patchSessionAfterLocalMutation(key, { table: sessionStatusFilter !== 'all' });
      await ipcRenderer.invoke('dashboard:archiveSession', item, nextArchived);
      await refreshNow({ windowLayout: false, instantChart: true, partial: true });
    } else {
      setRefreshState(TXT.actionDone);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    }
    return;
  }
  const select = e.target.closest('[data-session-select]');
  if(select){ selectedSessionId = select.dataset.sessionSelect; localStorage.setItem('selectedSessionId', selectedSessionId); if(select.dataset.table){ tableTab = select.dataset.table; localStorage.setItem('statsTableTab', tableTab); layoutMode = 'dashboard'; localStorage.setItem('layoutMode', layoutMode); if(tableTab === 'sessions'){ workspaceMode = 'sessions'; localStorage.setItem('workspaceMode', workspaceMode); } if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; } if(workspaceMode === 'sessions'){ patchSessionSelectionChrome(select); scheduleSessionInspectorPatch(8); return; } if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; }
  const requestSelect = e.target.closest('[data-request-select]');
  if(requestSelect){
    selectedRequestKey = requestSelect.dataset.requestSelect;
    localStorage.setItem('selectedRequestKey', selectedRequestKey);
    if(requestSelect.dataset.table){
      tableTab = requestSelect.dataset.table;
      localStorage.setItem('statsTableTab', tableTab);
      layoutMode = 'dashboard';
      localStorage.setItem('layoutMode', layoutMode);
      if(snapshot?.ok && patchAnalyticsSlotsForState(snapshot, { tableOnly: true })) return;
    }
    if(patchRequestSelection()) return;
    if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
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
      resetSessionPaging();
      workspaceMode = 'sessions';
      localStorage.setItem('workspaceMode', workspaceMode);
      localStorage.setItem('statsTableTab', tableTab);
      localStorage.setItem('selectedSessionId', selectedSessionId);
      localStorage.setItem('statsSessionQuery', sessionQuery);
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      return;
    }
    setRefreshState(TXT.copied);
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => setRefreshState(''), 900);
    return;
  }
  const status = e.target.closest('[data-session-status]');
  if(status){ sessionStatusFilter = status.dataset.sessionStatus; resetSessionPaging(); localStorage.setItem('sessionStatusFilter', sessionStatusFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); return; }
  const series = e.target.closest('[data-series]');
  if(series){ const key = series.dataset.series; if(visibleSeries.has(key)) visibleSeries.delete(key); else visibleSeries.add(key); saveVisibleSeries(); if(snapshot?.ok && patchAnalyticsChartOnly(snapshot)) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; }
  const cacheModel = e.target.closest('[data-cache-model]');
  if(cacheModel){ resetIncrementalRenderLimits('all'); modelFilter = cacheModel.dataset.cacheModel || 'all'; localStorage.setItem('statsModel', modelFilter); if(snapshot?.ok && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; }
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
    return;
  }
  const src = e.target.closest('[data-source]');
  const rangeApply = e.target.closest('[data-range-apply]');
  const tab = e.target.closest('[data-table]');
  if(rangeApply){ applyCustomDateInputs(); if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); return; }
  if(src){ resetIncrementalRenderLimits('all'); resetSessionPaging(); sourceFilter = src.dataset.source; localStorage.setItem('statsSource', sourceFilter); if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) return; if(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, { table: true, toolbar: false, inspector: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); }
  if(tab){ resetIncrementalRenderLimits('all'); const previousWorkspace = workspaceMode; tableTab = tab.dataset.table; localStorage.setItem('statsTableTab', tableTab); if(tableTab === 'sessions'){ workspaceMode = 'sessions'; resetSessionPaging(); localStorage.setItem('workspaceMode', workspaceMode); } else { workspaceMode = 'analytics'; localStorage.setItem('workspaceMode', workspaceMode); } const workspaceChanged = previousWorkspace !== workspaceMode; if(workspaceChanged){ document.getElementById('app')?.classList?.add?.('view-switching'); setAppInteractionMode('view-switching', 200); } if(tab.closest('.compact-panel-actions')){ layoutMode = 'dashboard'; localStorage.setItem('layoutMode', layoutMode); } if(snapshot?.ok && workspaceMode === 'analytics' && !workspaceChanged && patchAnalyticsSlotsForState(snapshot, { tableOnly: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true, deferHeavy: workspaceMode === 'analytics' && workspaceChanged && typeof ResizeObserver !== 'undefined' }); }
});
document.addEventListener('change', (e) => { const dateInput = e.target.closest('[data-date-range-date], [data-date-range-time]'); if(dateInput){ const which = dateInput.dataset.dateRangeDate || dateInput.dataset.dateRangeTime; const part = dateInput.dataset.dateRangeDate ? 'date' : 'time'; updateDateRangeDraft(which, part, dateInput.value); patchDateRangeChrome(); return; } const follow = e.target.closest('[data-date-range-follow]'); if(follow){ dateRangeFollowNow = follow.checked; if(dateRangeFollowNow) dateRangeDraftEnd = Number(snapshot?.timestamp || Date.now()); localStorage.setItem('dateRangeFollowNow', dateRangeFollowNow ? '1' : '0'); patchDateRangeChrome(); return; } const tags = e.target.closest('[data-session-tags]'); if(tags){ const key = tags.dataset.sessionTags; sessionMeta[key] = { ...(sessionMeta[key] || {}), tags: normalizeTags(tags.value) }; saveSessionMeta(); setRefreshState(TXT.savedLocal); clearTimeout(lastToastTimer); lastToastTimer = setTimeout(() => setRefreshState(''), 900); if(workspaceMode === 'sessions'){ patchSessionRow(key); patchSessionOverview(snapshot); patchSessionToolbar(snapshot); return; } if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; } const sel = e.target.closest('[data-select]'); if(!sel) return; if(sel.dataset.select === 'source'){ resetIncrementalRenderLimits('all'); resetSessionPaging(); sourceFilter = sel.value; localStorage.setItem('statsSource', sourceFilter); if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) return; if(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, { table: true, toolbar: false, inspector: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); } if(sel.dataset.select === 'model'){ resetIncrementalRenderLimits('all'); modelFilter = sel.value; localStorage.setItem('statsModel', modelFilter); if(snapshot?.ok && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); } if(sel.dataset.select === 'refresh'){ refreshEvery = sel.value; localStorage.setItem('statsRefreshEvery', refreshEvery); setupAutoRefresh(); } if(sel.dataset.select === 'range'){ resetIncrementalRenderLimits('all'); resetSessionPaging(); rangeFilter = normalizeRangeFilter(sel.value); const days = Number(String(rangeFilter).replace('d', '')); if(Number.isFinite(days)) localStorage.setItem('customRangeDays', String(days)); localStorage.setItem('statsRange', rangeFilter); if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) return; if(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, { table: true, toolbar: false, inspector: true })) return; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); } if(sel.dataset.select === 'sessionSort'){ resetIncrementalRenderLimits('sessions'); resetSessionPaging(); sessionSort = sel.value; localStorage.setItem('sessionSort', sessionSort); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); } if(sel.dataset.select === 'sessionTag'){ resetIncrementalRenderLimits('sessions'); resetSessionPaging(); sessionTagFilter = sel.value; localStorage.setItem('sessionTagFilter', sessionTagFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); } if(sel.dataset.select === 'sessionProject'){ resetIncrementalRenderLimits('sessions'); resetSessionPaging(); sessionProjectFilter = sel.value; localStorage.setItem('sessionProjectFilter', sessionProjectFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); } });
document.addEventListener('input', (e) => { const bulkTags = e.target.closest('[data-bulk-meta-tags]'); if(bulkTags){ bulkMetaTagsDraft = bulkTags.value; return; } const bulkNote = e.target.closest('[data-bulk-meta-note]'); if(bulkNote){ bulkMetaNoteDraft = bulkNote.value; return; } const savedViewName = e.target.closest('[data-saved-session-name]'); if(savedViewName){ savedSessionViewNameDraft = savedViewName.value; return; } const note = e.target.closest('[data-session-note]'); if(note){ const key = note.dataset.sessionNote; sessionMeta[key] = { ...(sessionMeta[key] || {}), note: note.value }; saveSessionMeta(); setRefreshState(TXT.savedLocal); clearTimeout(lastToastTimer); lastToastTimer = setTimeout(() => setRefreshState(''), 800); return; } const rename = e.target.closest('[data-rename-input]'); if(rename){ renameDraft = rename.value; return; } const q = e.target.closest('[data-query]'); if(!q) return; const scope = q.dataset.query === 'sessions' ? 'sessions' : 'analytics'; if(scope === 'sessions'){ sessionQuery = q.value; localStorage.setItem('statsSessionQuery', sessionQuery); } else { analyticsQuery = q.value; localStorage.setItem('statsAnalyticsQuery', analyticsQuery); } const app = document.getElementById('app'); app?.classList.add('is-typing'); clearTimeout(queryRenderTimer); queryRenderTimer = setTimeout(() => { queryRenderTimer = null; resetIncrementalRenderLimits(scope === 'sessions' ? 'sessions' : 'requests'); let patched = false; if(scope === 'sessions'){ resetSessionPaging(); patched = Boolean(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, { table: true, toolbar: false, inspector: true, overview: false })); } else { patched = Boolean(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { lowerOnly: true })); } if(!patched && snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); requestAnimationFrame(() => { const next = document.querySelector(`[data-query="${scope}"]`); if(next){ next.focus(); next.setSelectionRange(next.value.length, next.value.length); } app?.classList.remove('is-typing'); }); }, 140); });
