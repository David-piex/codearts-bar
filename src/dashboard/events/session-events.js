async function handleDashboardSessionClick(e){
    const bulkMetaCancel = e.target.closest('[data-bulk-meta-cancel]');
    const bulkMetaBackdrop = e.target?.dataset?.modalBackdrop === 'bulk-meta';
    if(bulkMetaCancel || bulkMetaBackdrop){
      bulkMetaOpen = false;
      bulkMetaTagsDraft = '';
      bulkMetaNoteDraft = '';
      patchSessionModalOrRender();
      throw DASHBOARD_EVENT_HANDLED;
    }
    const bulkMetaSave = e.target.closest('[data-bulk-meta-save]');
    if(bulkMetaSave){ saveBulkMetaSheet(); throw DASHBOARD_EVENT_HANDLED; }
    const renameCancel = e.target.closest('[data-rename-cancel]');
    const renameBackdrop = e.target?.dataset?.modalBackdrop === 'rename';
    if(renameCancel || renameBackdrop){
      renameSessionKey = '';
      renameDraft = '';
      patchSessionModalOrRender();
      throw DASHBOARD_EVENT_HANDLED;
    }
    const renameSave = e.target.closest('[data-rename-save]');
    if(renameSave){ await saveRenameSheet(); throw DASHBOARD_EVENT_HANDLED; }
    const smartView = e.target.closest('[data-session-smart-view]');
    if(smartView){ applySessionSmartView(smartView.dataset.sessionSmartView || 'recent'); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); throw DASHBOARD_EVENT_HANDLED; }
    const saveView = e.target.closest('[data-saved-session-save]');
    if(saveView){
      saveCurrentSessionView();
      setRefreshState(TXT.savedLocal);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
      patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const applySavedView = e.target.closest('[data-saved-session-apply]');
    if(applySavedView){
      const view = savedSessionViews.find((x) => x.id === applySavedView.dataset.savedSessionApply);
      applySavedSessionView(view);
      setRefreshState(TXT.savedViewApplied);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
      patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const deleteSavedView = e.target.closest('[data-saved-session-delete]');
    if(deleteSavedView){
      savedSessionViews = savedSessionViews.filter((x) => x.id !== deleteSavedView.dataset.savedSessionDelete);
      saveSavedSessionViews();
      setRefreshState(TXT.savedViewDeleted);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
      patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const advancedToggle = e.target.closest('[data-session-advanced-toggle]');
    if(advancedToggle){
      sessionAdvancedOpen = false;
      try { localStorage.removeItem('sessionAdvancedOpen'); } catch {}
      patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false });
      throw DASHBOARD_EVENT_HANDLED;
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
      throw DASHBOARD_EVENT_HANDLED;
    }
    const quick = e.target.closest('[data-session-quick]');
    if(quick){ sessionQuickFilter = quick.dataset.sessionQuick || 'all'; resetSessionPaging(); localStorage.setItem('sessionQuickFilter', sessionQuickFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); throw DASHBOARD_EVENT_HANDLED; }
    const project = e.target.closest('[data-session-project]');
    if(project){ sessionProjectFilter = project.dataset.sessionProject || 'all'; resetSessionPaging(); localStorage.setItem('sessionProjectFilter', sessionProjectFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); throw DASHBOARD_EVENT_HANDLED; }
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
      throw DASHBOARD_EVENT_HANDLED;
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
        throw DASHBOARD_EVENT_HANDLED;
      }
      if(action === 'copy'){
        await navigator.clipboard.writeText(sessionCacheGovernanceReport(snapshot || {}));
        setRefreshState(TXT.cacheGovernanceCopied);
        clearTimeout(lastToastTimer);
        lastToastTimer = setTimeout(() => setRefreshState(''), 900);
        throw DASHBOARD_EVENT_HANDLED;
      }
    }
    const sessionPage = e.target.closest('[data-session-page]');
    const sessionPageGo = e.target.closest('[data-session-page-go]');
    if(sessionPage || sessionPageGo){
      const total = Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.total || 0);
      const maxPage = Math.max(0, Math.ceil(total / SESSION_PAGE_SIZE) - 1);
      if(sessionPage) sessionTablePage += sessionPage.dataset.sessionPage === 'next' ? 1 : -1;
      if(sessionPageGo){
        const input = document.querySelector('[data-session-page-input]');
        sessionTablePage = Math.max(0, Number(input?.value || 1) - 1);
      }
      sessionTablePage = Math.max(0, Math.min(maxPage, sessionTablePage));
      localStorage.setItem('sessionTablePage', String(sessionTablePage));
      if(workspaceMode === 'sessions'){
        if(canUseDbSessionPage()) await refreshSessionPageCache(sessionTablePage, { force: true });
        if(patchSessionView(snapshot, { table: true, toolbar: false, inspector: true, pageChange: true })) throw DASHBOARD_EVENT_HANDLED;
      }
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const checkAll = e.target.closest('[data-session-check-all]');
    if(checkAll){
      const domState = captureSessionDomState();
      const all = sessionTableItems.map(sessionKeyFor);
      const allSelected = all.length && all.every((k) => selectedSessionKeys.has(k));
      if(allSelected) all.forEach((k) => selectedSessionKeys.delete(k));
      else all.forEach((k) => selectedSessionKeys.add(k));
      saveSelectedSessions();
      if(workspaceMode === 'sessions' && patchSessionCheckboxes()){ restoreSessionDomState(domState); throw DASHBOARD_EVENT_HANDLED; }
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const check = e.target.closest('[data-session-check]');
    if(check){
      const key = check.dataset.sessionCheck;
      if(selectedSessionKeys.has(key)) selectedSessionKeys.delete(key); else selectedSessionKeys.add(key);
      saveSelectedSessions();
      if(workspaceMode === 'sessions'){
        patchSessionCheckboxes(new Set([key]));
        throw DASHBOARD_EVENT_HANDLED;
      }
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const pin = e.target.closest('[data-session-pin]');
    if(pin){
      const key = pin.dataset.sessionPin;
      if(pinnedSessionKeys.has(key)) pinnedSessionKeys.delete(key); else pinnedSessionKeys.add(key);
      savePinnedSessions();
      if(workspaceMode === 'sessions' && patchSessionAfterLocalMutation(key, { table: sessionQuickFilter === 'pinned' })) throw DASHBOARD_EVENT_HANDLED;
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const bulk = e.target.closest('[data-session-bulk]');
    if(bulk){
      const action = bulk.dataset.sessionBulk;
      const items = selectedSessionItems();
      if(action === 'select-all'){
        sessionTableItems.forEach((item) => selectedSessionKeys.add(sessionKeyFor(item)));
        saveSelectedSessions();
        if(workspaceMode === 'sessions' && patchSessionCheckboxes()) throw DASHBOARD_EVENT_HANDLED;
        if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
        throw DASHBOARD_EVENT_HANDLED;
      }
      if(action === 'clear'){
        selectedSessionKeys.clear();
        saveSelectedSessions();
        if(workspaceMode === 'sessions' && patchSessionCheckboxes()) throw DASHBOARD_EVENT_HANDLED;
        if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
        throw DASHBOARD_EVENT_HANDLED;
      }
      if(!items.length) throw DASHBOARD_EVENT_HANDLED;
      if(action === 'tag'){
        bulkMetaOpen = true;
        bulkMetaTagsDraft = '';
        bulkMetaNoteDraft = '';
        patchSessionModalOrRender();
        requestAnimationFrame(() => document.querySelector('[data-bulk-meta-tags]')?.focus());
        throw DASHBOARD_EVENT_HANDLED;
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
        throw DASHBOARD_EVENT_HANDLED;
      }
      setRefreshState(TXT.actionDone);
      clearTimeout(lastToastTimer);
      lastToastTimer = setTimeout(() => setRefreshState(''), 900);
      throw DASHBOARD_EVENT_HANDLED;
    }
    const action = e.target.closest('[data-session-action]');
    if(action){
      const key = action.dataset.sessionKey || sessionTableItems[Number(action.dataset.sessionIndex)] && sessionKeyFor(sessionTableItems[Number(action.dataset.sessionIndex)]);
      const item = sessionTableItems.find((x) => sessionKeyFor(x) === key) || sessionByKey(key);
      if(!item) throw DASHBOARD_EVENT_HANDLED;
      if(action.dataset.sessionAction === 'focus-requests'){
        tableTab = 'requests';
        analyticsQuery = item.id || '';
        workspaceMode = 'analytics';
        localStorage.setItem('workspaceMode', workspaceMode);
        localStorage.setItem('statsTableTab', tableTab);
        localStorage.setItem('statsAnalyticsQuery', analyticsQuery);
        if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
        throw DASHBOARD_EVENT_HANDLED;
      }
      if(action.dataset.sessionAction === 'open') await ipcRenderer.invoke('dashboard:openSession', item);
      if(action.dataset.sessionAction === 'open-codearts') await ipcRenderer.invoke('dashboard:openCodeArtsSession', item);
      if(action.dataset.sessionAction === 'rename'){
        renameSessionKey = key;
        renameDraft = item.title || '';
        patchSessionModalOrRender();
        requestAnimationFrame(() => { const input = document.querySelector('[data-rename-input]'); input?.focus(); input?.select(); });
        throw DASHBOARD_EVENT_HANDLED;
      }
      if(action.dataset.sessionAction === 'copy-summary'){ await ensureSessionRequests(item, 12); await navigator.clipboard.writeText(sessionSummaryText(item)); }
      if(action.dataset.sessionAction === 'copy-markdown'){ await ensureSessionRequests(item, 80); await navigator.clipboard.writeText(sessionMarkdown(item)); }
      if(action.dataset.sessionAction === 'copy-requests-json'){ await ensureSessionRequests(item, 200); await navigator.clipboard.writeText(JSON.stringify(sessionRequests(item, 200), null, 2)); }
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
      throw DASHBOARD_EVENT_HANDLED;
    }
    const select = e.target.closest('[data-session-select]');
    if(select){ selectedSessionId = select.dataset.sessionSelect; localStorage.setItem('selectedSessionId', selectedSessionId); if(select.dataset.table){ tableTab = select.dataset.table; localStorage.setItem('statsTableTab', tableTab); layoutMode = 'dashboard'; localStorage.setItem('layoutMode', layoutMode); if(tableTab === 'sessions'){ workspaceMode = 'sessions'; localStorage.setItem('workspaceMode', workspaceMode); } if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; } if(workspaceMode === 'sessions'){ patchSessionSelectionChrome(select); scheduleSessionInspectorPatch(8); throw DASHBOARD_EVENT_HANDLED; } if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; }
    const status = e.target.closest('[data-session-status]');
    if(status){ sessionStatusFilter = status.dataset.sessionStatus; resetSessionPaging(); localStorage.setItem('sessionStatusFilter', sessionStatusFilter); patchSessionsOrRender({ table: true, toolbar: true, inspector: true, overview: true }); throw DASHBOARD_EVENT_HANDLED; }
  return false;
}
