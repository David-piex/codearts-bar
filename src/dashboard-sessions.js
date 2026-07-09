eval([
  'dashboard/sessions/session-meta.js',
  'dashboard/sessions/session-filters.js',
  'dashboard/sessions/session-saved-views.js',
  'dashboard/sessions/session-bulk.js',
  'dashboard/sessions/session-cache-governance.js',
  'dashboard/sessions/session-inspector.js',
  'dashboard/sessions/session-table.js',
  'dashboard/sessions/session-workspace.js',
].map(readRendererPart).join('\n'));
function sessionSimpleToolbarHtml(s){
  return `<section class="session-simple-shell session-library-shell"><div class="session-simple-head"><div><b>${TXT.sessionEssentials}</b><span>${TXT.sessionEssentialsHint}</span></div></div>${sessionQuickFilterHtml(s)}${sessionSavedViewsInlineHtml(s)}</section>`;
}
function sessionAdvancedHtml(s){
  return '';
}
function sessionFiltersActive(){ return sessionQuickFilter !== 'all' || sessionProjectFilter !== 'all' || sessionStatusFilter !== 'active' || sessionTagFilter !== 'all' || sessionQuery.trim(); }
function sessionFilterContextHtml(s){
  if(!sessionFiltersActive()) return '';
  const chips = [
    [TXT.quickView, labelForQuickFilter()],
    [TXT.project, labelForProjectFilter(s)],
    [TXT.sessionStatus, sessionStatusFilter === 'active' ? TXT.activeSessions : sessionStatusFilter === 'archived' ? TXT.archivedSessions : TXT.allSessions],
    [TXT.tagFilter, labelForTagFilter()],
  ];
  if(sessionQuery.trim()) chips.push([TXT.searchKeyword, sessionQuery.trim()]);
  return `<div class="session-filter-context"><div><span>${TXT.filterContext}</span>${chips.map(([k, v]) => `<b>${esc(k)}: ${esc(v)}</b>`).join('')}</div><button data-session-reset-filters="1" ${sessionFiltersActive() ? '' : 'disabled'}>${TXT.resetFilters}</button></div>`;
}
function renderRenameSheet(){
  if(!renameSessionKey || !snapshot?.ok) return '';
  const item = sessionByKey(renameSessionKey);
  if(!item) return '';
  const value = renameDraft || item.title || '';
  return `<div class="modal-backdrop" data-modal-backdrop="rename"><div class="rename-sheet" role="dialog" aria-modal="true" data-modal="rename"><div class="rename-head"><div><b>${TXT.renameTitle}</b><span>${esc(item.id || '')}</span></div><button data-rename-cancel="1">&#215;</button></div><label>${TXT.renameHint}<input data-rename-input value="${esc(value)}" /></label><div class="rename-actions"><button data-rename-cancel="1">${TXT.cancel}</button><button class="primary" data-rename-save="1">${TXT.save}</button></div></div></div>`;
}
async function saveRenameSheet(){
  const key = renameSessionKey;
  const item = sessionByKey(key);
  const next = String(renameDraft || '').trim();
  if(!item || !next) return;
  setRefreshState(TXT.refresh);
  await ipcRenderer.invoke('dashboard:renameSession', item, next);
  item.title = next;
  renameSessionKey = '';
  renameDraft = '';
  if(workspaceMode === 'sessions') patchSessionAfterLocalMutation(key, { table: false });
  await refreshNow({ windowLayout: false, instantChart: true, partial: true });
}
