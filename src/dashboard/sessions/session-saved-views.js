function smartViewDefs(){
  return [
    { key: 'cacheWaste', label: TXT.smartViewCacheWaste, hint: TXT.smartViewCacheWasteHint, tone: 'warn' },
    { key: 'pinned', label: TXT.smartViewPinned, hint: TXT.smartViewPinnedHint, tone: 'blue' },
    { key: 'recent', label: TXT.smartViewRecent, hint: TXT.smartViewRecentHint, tone: 'green' },
    { key: 'triage', label: TXT.smartViewTriage, hint: TXT.smartViewTriageHint, tone: 'plain' },
    { key: 'archive', label: TXT.smartViewArchive, hint: TXT.smartViewArchiveHint, tone: 'muted' },
  ];
}
function smartViewItems(s){
  return (s.sessions || []).filter((item) => sourceFilter === 'all' || sourceKey(item) === sourceFilter);
}
function smartViewMatches(item, key){
  const u = item.usage || {};
  const meta = metaForSession(item);
  if(key === 'cacheWaste') return !item.archived && Number(u.total || 0) > 0 && (cacheHitRate(u) == null || cacheHitRate(u) < 25);
  if(key === 'pinned') return !item.archived && isPinnedSession(item);
  if(key === 'recent') return !item.archived && (Date.now() - Number(item.updatedAt || 0)) <= 7 * 86400000;
  if(key === 'triage') return !item.archived && !(meta.tags || []).length && !meta.note;
  if(key === 'archive') return Boolean(item.archived);
  return false;
}
function smartViewActive(key){
  if(key === 'cacheWaste') return sessionQuickFilter === 'cacheLow' && sessionStatusFilter === 'active' && sessionSort === 'opportunity';
  if(key === 'pinned') return sessionQuickFilter === 'pinned' && sessionStatusFilter === 'active';
  if(key === 'recent') return sessionQuickFilter === 'recent' && sessionStatusFilter === 'active';
  if(key === 'triage') return sessionQuickFilter === 'all' && sessionStatusFilter === 'active' && sessionTagFilter === '__none';
  if(key === 'archive') return sessionQuickFilter === 'all' && sessionStatusFilter === 'archived';
  return false;
}
function saveSessionViewState(){
  localStorage.setItem('sessionQuickFilter', sessionQuickFilter);
  localStorage.setItem('sessionProjectFilter', sessionProjectFilter);
  localStorage.setItem('sessionStatusFilter', sessionStatusFilter);
  localStorage.setItem('sessionTagFilter', sessionTagFilter);
  localStorage.setItem('sessionSort', sessionSort);
  localStorage.setItem('statsSessionQuery', sessionQuery);
}
function currentSessionViewState(){
  return {
    sourceFilter,
    sessionQuickFilter,
    sessionProjectFilter,
    sessionStatusFilter,
    sessionTagFilter,
    sessionSort,
    sessionQuery,
  };
}
function applySavedSessionView(view){
  if(!view?.state) return;
  sourceFilter = view.state.sourceFilter || 'all';
  sessionQuickFilter = view.state.sessionQuickFilter || 'all';
  sessionProjectFilter = view.state.sessionProjectFilter || 'all';
  sessionStatusFilter = view.state.sessionStatusFilter || 'active';
  sessionTagFilter = view.state.sessionTagFilter || 'all';
  sessionSort = view.state.sessionSort || 'updated';
  sessionQuery = view.state.sessionQuery || '';
  localStorage.setItem('statsSource', sourceFilter);
  saveSessionViewState();
}
function savedViewSummary(view, s){
  const state = view?.state || {};
  const chips = [
    labelForQuickFilterValue(state.sessionQuickFilter || 'all'),
    labelForProjectFilterValue(s, state.sessionProjectFilter || 'all'),
    state.sessionStatusFilter === 'archived' ? TXT.archivedSessions : state.sessionStatusFilter === 'all' ? TXT.allSessions : TXT.activeSessions,
    labelForTagFilterValue(state.sessionTagFilter || 'all'),
  ];
  if(state.sourceFilter && state.sourceFilter !== 'all') chips.unshift(sourceLabelFor(s, state.sourceFilter));
  if(state.sessionQuery) chips.push(state.sessionQuery);
  return chips.filter(Boolean).join(' / ');
}
function saveCurrentSessionView(){
  const name = String(savedSessionViewNameDraft || '').trim() || `${labelForProjectFilter(snapshot || {})} / ${labelForQuickFilter()}`;
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  savedSessionViews = [{ id, name, createdAt: Date.now(), state: currentSessionViewState() }, ...savedSessionViews.filter((v) => v.name !== name)].slice(0, 24);
  saveSavedSessionViews();
  savedSessionViewNameDraft = '';
}
function applySessionSmartView(key){
  sessionProjectFilter = 'all';
  sessionQuery = '';
  sessionTagFilter = 'all';
  sessionSort = 'updated';
  sessionQuickFilter = 'all';
  sessionStatusFilter = 'active';
  if(key === 'cacheWaste'){
    sessionQuickFilter = 'cacheLow';
    sessionSort = 'opportunity';
  } else if(key === 'pinned'){
    sessionQuickFilter = 'pinned';
  } else if(key === 'recent'){
    sessionQuickFilter = 'recent';
  } else if(key === 'triage'){
    sessionTagFilter = '__none';
  } else if(key === 'archive'){
    sessionStatusFilter = 'archived';
  }
  saveSessionViewState();
}
function sessionSmartViewsHtml(s){
  const items = smartViewItems(s);
  return `<div class="session-smart-views"><div class="session-rail-head"><b>${TXT.smartViews}</b><span>${TXT.smartViewsHint}</span></div><div class="smart-view-list">${smartViewDefs().map((view) => { const count = items.filter((item) => smartViewMatches(item, view.key)).length; return `<button data-session-smart-view="${view.key}" class="${view.tone} ${smartViewActive(view.key) ? 'active' : ''}"><span><b>${esc(view.label)}</b><em>${esc(view.hint)}</em></span><strong>${n(count)}</strong></button>`; }).join('')}</div></div>`;
}
function sessionProjectRailHtml(s){
  const projects = sessionProjectOptions(s).slice(0, 8);
  if(!projects.length) return '';
  const max = Math.max(1, ...projects.map((p) => p.count));
  return `<div class="session-project-rail"><div class="session-rail-head"><b>${TXT.projectView}</b><span>${TXT.sessionWorkspaceHint}</span></div><div class="session-project-list"><button data-session-project="all" class="${sessionProjectFilter === 'all' ? 'active' : ''}"><span>${TXT.allProjects}</span><strong>${n(projects.reduce((sum, p) => sum + p.count, 0))}</strong><i style="--w:100%"></i></button>${projects.map((p) => `<button data-session-project="${esc(p.key)}" class="${sessionProjectFilter === p.key ? 'active' : ''}" title="${esc(p.key)}"><span>${esc(p.label)}</span><strong>${n(p.count)}</strong><em>${compact(p.total)} token</em><i style="--w:${Math.max(8, Math.min(100, (p.count / max) * 100))}%"></i></button>`).join('')}</div></div>`;
}
function sessionSavedViewsHtml(s){
  const list = savedSessionViews.slice(0, 8);
  const body = list.length ? list.map((view) => `<div class="saved-view-row"><button data-saved-session-apply="${esc(view.id)}"><span><b>${esc(view.name || TXT.savedViews)}</b><em>${esc(savedViewSummary(view, s))}</em></span><strong>${esc(dateLabel(view.createdAt || Date.now()))}</strong></button><button class="saved-view-delete" data-saved-session-delete="${esc(view.id)}" title="${TXT.deleteView}">&#215;</button></div>`).join('') : `<div class="saved-view-empty">${TXT.noSavedViews}</div>`;
  return `<div class="session-saved-views"><div class="session-rail-head"><b>${TXT.savedViews}</b><span>${TXT.savedViewsHint}</span></div><div class="saved-view-composer"><input data-saved-session-name value="${esc(savedSessionViewNameDraft)}" placeholder="${TXT.savedViewNamePlaceholder}" aria-label="${TXT.savedViewName}" /><button data-saved-session-save="1">${TXT.saveCurrentView}</button></div><div class="saved-view-list">${body}</div></div>`;
}
function sessionSavedViewsInlineHtml(s){
  const list = savedSessionViews.slice(0, 3);
  const body = list.length
    ? list.map((view) => `<div class="saved-view-row compact"><button data-saved-session-apply="${esc(view.id)}"><span><b>${esc(view.name || TXT.savedViews)}</b><em>${esc(savedViewSummary(view, s))}</em></span></button><button class="saved-view-delete" data-saved-session-delete="${esc(view.id)}" title="${TXT.deleteView}">&#215;</button></div>`).join('')
    : `<div class="saved-view-empty compact">${TXT.noSavedViews}</div>`;
  return `<div class="session-saved-inline"><div class="saved-view-composer compact"><input data-saved-session-name value="${esc(savedSessionViewNameDraft)}" placeholder="${TXT.savedViewNamePlaceholder}" aria-label="${TXT.savedViewName}" /><button data-saved-session-save="1">${TXT.saveCurrentView}</button></div><div class="saved-view-list compact">${body}</div></div>`;
}
