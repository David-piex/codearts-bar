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
function sessionIntentBarHtml(){
  return `<div class="session-intent-row"><span><b>\u770b\u5230</b><em>\u4f1a\u8bdd\u5217\u8868\u548c\u5f53\u524d\u72b6\u6001</em></span><span><b>\u7ba1\u7406</b><em>\u6253\u5f00\u3001\u91cd\u547d\u540d\u3001\u56fa\u5b9a\u3001\u5f52\u6863</em></span><span><b>\u4fdd\u5b58</b><em>\u6807\u7b7e\u3001\u5907\u6ce8\u548c\u5e38\u7528\u89c6\u56fe</em></span></div>`;
}
function sessionSimpleToolbarHtml(s){
  return `<section class="session-simple-shell session-library-shell"><div class="session-simple-head"><div><b>${TXT.sessionEssentials}</b><span>${TXT.sessionEssentialsHint}</span></div><button data-session-advanced-toggle="1" class="${sessionAdvancedOpen ? 'active' : ''}">${sessionAdvancedOpen ? TXT.hideAdvanced : TXT.showAdvanced}</button></div>${sessionIntentBarHtml()}${sessionQuickFilterHtml(s)}${sessionSavedViewsInlineHtml(s)}</section>`;
}
function sessionAdvancedHtml(s){
  if(!sessionAdvancedOpen) return '';
  return `<section class="session-advanced-shell session-library-advanced"><div class="session-advanced-head"><div><b>${TXT.advancedManagement}</b><span>${TXT.advancedManagementHint}</span></div><button data-session-advanced-toggle="1">${TXT.hideAdvanced}</button></div><div class="session-advanced-controls">${sessionStatusHtml()}${sessionProjectFilterHtml(s)}${sessionTagFilterHtml()}${sessionSortHtml()}${sessionBulkHtml(true)}</div>${sessionSavedViewsHtml(s)}</section>`;
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
  const item = sessionByKey(renameSessionKey);
  const next = String(renameDraft || '').trim();
  if(!item || !next) return;
  setRefreshState(TXT.refresh);
  await ipcRenderer.invoke('dashboard:renameSession', item, next);
  renameSessionKey = '';
  renameDraft = '';
  await refreshNow({ windowLayout: false, instantChart: true, partial: true });
}
