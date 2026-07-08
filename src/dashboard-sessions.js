function sessionKeyFor(session){ return `${session.source || ''}:${session.id || ''}`; }
function metaForSession(item){ return sessionMeta[sessionKeyFor(item)] || { tags: [], note: '' }; }
function normalizeTags(value){ return String(value || '').split(/[,，]/u).map((x) => x.trim()).filter(Boolean).slice(0, 8); }
function sessionTagsHtml(item, limit = 4){ const tags = metaForSession(item).tags || []; if(!tags.length) return `<span class="muted">-</span>`; return `<div class="session-tags">${tags.slice(0, limit).map((tag) => `<span class="session-tag">${esc(tag)}</span>`).join('')}${tags.length > limit ? `<span class="session-tag more">+${tags.length - limit}</span>` : ''}</div>`; }
function sessionStatusMatches(session){ if(sessionStatusFilter === 'all') return true; if(sessionStatusFilter === 'archived') return Boolean(session.archived); return !session.archived; }
function sessionMatches(session){ if(sourceFilter !== 'all' && sourceKey(session) !== sourceFilter) return false; if(sessionProjectFilter !== 'all' && sessionProjectKey(session) !== sessionProjectFilter) return false; if(!sessionStatusMatches(session)) return false; if(!sessionQuickMatches(session)) return false; const meta = metaForSession(session); const tags = meta.tags || []; if(sessionTagFilter === '__none' && tags.length) return false; if(sessionTagFilter !== 'all' && sessionTagFilter !== '__none' && !tags.includes(sessionTagFilter)) return false; const q = sessionQuery.trim().toLowerCase(); if(!q) return true; return `${session.title || ''} ${session.id || ''} ${session.directory || ''} ${sessionProjectName(session)} ${sourceName(session)} ${session.usage?.topModel?.model || ''} ${tags.join(' ')} ${meta.note || ''}`.toLowerCase().includes(q); }
function sortSessions(list){ const arr = [...list]; const score = (x) => x.usage || {}; arr.sort((a, b) => { const pa = isPinnedSession(a) ? 1 : 0; const pb = isPinnedSession(b) ? 1 : 0; if(pa !== pb) return pb - pa; if(sessionSort === 'opportunity') return cacheOpportunityScore(score(b)) - cacheOpportunityScore(score(a)) || (score(b).total || 0) - (score(a).total || 0); if(sessionSort === 'token') return (score(b).total || 0) - (score(a).total || 0); if(sessionSort === 'turns') return (score(b).userTurns || 0) - (score(a).userTurns || 0); if(sessionSort === 'cache') return (cacheHitRate(score(b)) || -1) - (cacheHitRate(score(a)) || -1) || (score(b).total || 0) - (score(a).total || 0); return (b.updatedAt || 0) - (a.updatedAt || 0); }); return arr; }
function sessionStatusHtml(){ const opts = [['active', TXT.activeSessions], ['all', TXT.allSessions], ['archived', TXT.archivedSessions]]; return `<div class="session-filter"><span>${TXT.sessionStatus}</span>${opts.map(([k, label]) => `<button data-session-status="${k}" class="${sessionStatusFilter === k ? 'active' : ''}">${label}</button>`).join('')}</div>`; }
function sessionSortHtml(){ const opts = [['updated', TXT.byUpdated], ['token', TXT.byToken], ['turns', TXT.byTurns]]; if(!opts.some(([k]) => k === sessionSort)){ sessionSort = 'updated'; localStorage.setItem('sessionSort', sessionSort); } return `<div class="select session-sort"><span>${TXT.sort}</span><select data-select="sessionSort">${opts.map(([k, label]) => `<option value="${k}" ${sessionSort === k ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`; }
function sessionTagOptions(){
  const tags = new Set();
  for(const meta of Object.values(sessionMeta || {})) for(const tag of meta.tags || []) tags.add(tag);
  return [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
function sessionTagFilterHtml(){
  const tags = sessionTagOptions();
  if(sessionTagFilter !== 'all' && sessionTagFilter !== '__none' && !tags.includes(sessionTagFilter)) sessionTagFilter = 'all';
  return `<div class="select session-sort session-tag-select"><span>${TXT.tagFilter}</span><select data-select="sessionTag"><option value="all" ${sessionTagFilter === 'all' ? 'selected' : ''}>${TXT.allTags}</option><option value="__none" ${sessionTagFilter === '__none' ? 'selected' : ''}>${TXT.noTags}</option>${tags.map((tag) => `<option value="${esc(tag)}" ${sessionTagFilter === tag ? 'selected' : ''}>${esc(tag)}</option>`).join('')}</select></div>`;
}
function sessionProjectKey(item){ return item?.directory ? String(item.directory) : '__none'; }
function sessionProjectName(item){
  const dir = String(item?.directory || '');
  if(!dir) return TXT.noProject;
  const normalized = dir.replace(/\\/g, '/').replace(/\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(-1)[0] || dir || TXT.noProject;
}
function sessionProjectOptions(s){
  const map = new Map();
  for(const item of (s.sessions || [])){
    if(sourceFilter !== 'all' && sourceKey(item) !== sourceFilter) continue;
    const key = sessionProjectKey(item);
    const prev = map.get(key) || { key, label: sessionProjectName(item), count: 0, total: 0, active: 0 };
    prev.count += 1;
    prev.total += Number(item.usage?.total || 0);
    if(!item.archived) prev.active += 1;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label, 'zh-CN')).slice(0, 80);
}
function sessionProjectFilterHtml(s){
  const projects = sessionProjectOptions(s);
  if(sessionProjectFilter !== 'all' && !projects.some((p) => p.key === sessionProjectFilter)){ sessionProjectFilter = 'all'; localStorage.setItem('sessionProjectFilter', sessionProjectFilter); }
  return `<div class="select session-sort session-project-select"><span>${TXT.project}</span><select data-select="sessionProject"><option value="all" ${sessionProjectFilter === 'all' ? 'selected' : ''}>${TXT.allProjects}</option>${projects.map((p) => `<option value="${esc(p.key)}" ${sessionProjectFilter === p.key ? 'selected' : ''}>${esc(p.label)} &#183; ${n(p.count)}</option>`).join('')}</select></div>`;
}
function sessionQuickMatches(session, key = sessionQuickFilter){
  const u = session.usage || {};
  const meta = metaForSession(session);
  if(key === 'pinned') return isPinnedSession(session);
  if(key === 'tagged') return Boolean((meta.tags || []).length || meta.note);
  if(key === 'cacheHigh') return (cacheHitRate(u) || 0) >= 60;
  if(key === 'cacheLow') return (cacheHitRate(u) || 0) < 25;
  if(key === 'recent') return (Date.now() - Number(session.updatedAt || 0)) <= 7 * 86400000;
  return true;
}
function sessionPrimaryFilterActive(key){
  if(key === 'archived') return sessionStatusFilter === 'archived';
  if(key === 'all') return sessionStatusFilter === 'active' && sessionQuickFilter === 'all';
  return sessionStatusFilter === 'active' && sessionQuickFilter === key;
}
function sessionQuickFilterHtml(s){
  const base = (s.sessions || []).filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter));
  const active = base.filter((item) => !item.archived);
  const countFor = (key) => {
    if(key === 'archived') return base.filter((item) => item.archived).length;
    if(key === 'all') return active.length;
    return active.filter((item) => sessionQuickMatches(item, key)).length;
  };
  const opts = [['all', TXT.all], ['recent', TXT.recentActiveView], ['pinned', TXT.pinnedOnly], ['tagged', TXT.taggedOnly], ['archived', TXT.quickArchive]];
  return `<div class="session-quick session-primary-filters"><span>${TXT.sessionEssentials}</span>${opts.map(([k, label]) => `<button data-session-primary-filter="${k}" class="${sessionPrimaryFilterActive(k) ? 'active' : ''}">${esc(label)}<b>${n(countFor(k))}</b></button>`).join('')}</div>`;
}
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
function sessionBulkHtml(showWhenEmpty = true){
  const selected = selectedSessionItems();
  if(!showWhenEmpty && !selected.length) return '';
  const disabled = selected.length ? '' : 'disabled';
  const simple = !sessionAdvancedOpen && !showWhenEmpty;
  if(simple) return `<div class="session-bulk simple"><span>${TXT.selected} ${n(selected.length)}</span><button data-session-bulk="clear" ${disabled}>${TXT.clearSelection}</button><button data-session-bulk="copy-summary" ${disabled}>${TXT.copySelected}</button><button data-session-bulk="archive" ${disabled}>${TXT.archiveSelected}</button><button data-session-bulk="restore" ${disabled}>${TXT.restoreSelected}</button></div>`;
  return `<div class="session-bulk"><span>${TXT.selected} ${n(selected.length)}</span><button data-session-bulk="select-all">${TXT.selectAll}</button><button data-session-bulk="clear" ${disabled}>${TXT.clearSelection}</button><button data-session-bulk="tag" ${disabled}>${TXT.bulkTag}</button><button data-session-bulk="copy-summary" ${disabled}>${TXT.copySelected}</button><button data-session-bulk="copy-markdown" ${disabled}>${TXT.exportMarkdown}</button><button data-session-bulk="copy-json" ${disabled}>${TXT.exportJson}</button><button data-session-bulk="copy-csv" ${disabled}>${TXT.exportCsv}</button><button data-session-bulk="archive" ${disabled}>${TXT.archiveSelected}</button><button data-session-bulk="restore" ${disabled}>${TXT.restoreSelected}</button></div>`;
}
eval(readRendererPart('dashboard/sessions/session-inspector.js'));
eval(readRendererPart('dashboard/sessions/session-table.js'));
function labelForQuickFilterValue(value){
  const map = { all: TXT.viewAll, pinned: TXT.pinnedOnly, tagged: TXT.taggedOnly, cacheHigh: TXT.cacheHigh, cacheLow: TXT.cacheLow, recent: TXT.recentActiveView };
  return map[value] || TXT.viewAll;
}
function labelForQuickFilter(){ return labelForQuickFilterValue(sessionQuickFilter); }
function labelForProjectFilterValue(s, value){
  if(value === 'all') return TXT.allProjects;
  return sessionProjectOptions(s).find((p) => p.key === value)?.label || projectNameForKey(s, value) || TXT.noProject;
}
function labelForProjectFilter(s){ return labelForProjectFilterValue(s, sessionProjectFilter); }
function projectNameForKey(s, key){
  const item = (s?.sessions || []).find((x) => sessionProjectKey(x) === key);
  return item ? sessionProjectName(item) : '';
}
function labelForTagFilterValue(value){
  if(value === 'all') return TXT.allTags;
  if(value === '__none') return TXT.noTags;
  return value;
}
function labelForTagFilter(){ return labelForTagFilterValue(sessionTagFilter); }
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
function sessionCacheGovernanceCandidates(s, limit = 6){
  return (s.sessions || [])
    .filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter) && sessionStatusMatches(item))
    .map((item) => {
      const usage = item.usage || {};
      const hit = cacheHitRate(usage);
      const score = cacheOpportunityScore(usage);
      const health = cacheHealth(usage);
      const reason = hit == null ? TXT.cacheActionNone : hit < 25 ? TXT.cacheActionLow : hit < 60 ? TXT.cacheActionMid : TXT.cacheActionHigh;
      return { item, usage, hit, score, health, reason };
    })
    .filter((x) => Number(x.usage.total || 0) > 0 && (x.hit == null || x.hit < 60 || x.score > 10000))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.usage.total || 0) - (a.usage.total || 0))
    .slice(0, limit);
}
function sessionCacheGovernanceStats(items){
  const usage = items.reduce((acc, x) => addSessionUsage(acc, x.usage || {}), { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, calls: 0 });
  const potential = items.reduce((sum, x) => sum + Number(x.score || 0), 0);
  return { usage, potential, hit: cacheHitRate(usage) };
}
function sessionCacheGovernanceReport(s){
  const items = sessionCacheGovernanceCandidates(s, 12);
  const stats = sessionCacheGovernanceStats(items);
  const lines = [
    `# ${TXT.cacheGovernance}`,
    '',
    `- ${TXT.project}: ${labelForProjectFilter(s)}`,
    `- ${TXT.source}: ${sourceFilter === 'all' ? TXT.allSource : sourceLabelFor(s, sourceFilter)}`,
    `- ${TXT.cacheGovernanceCandidates}: ${n(items.length)}`,
    `- ${TXT.cacheGovernanceWeighted}: ${cacheHitText(stats.usage)}`,
    `- ${TXT.cacheGovernancePotential}: ${compact(stats.potential)} token`,
    '',
    `| ${TXT.session} | ${TXT.project} | ${TXT.total} | ${TXT.cacheHitRate} | ${TXT.cacheOpportunityScore} | ${TXT.cacheGovernanceReason} |`,
    '|---|---|---:|---:|---:|---|',
  ];
  if(!items.length) lines.push(`| ${TXT.noData} |  | 0 | N/A | 0 | ${TXT.cacheGovernanceEmpty} |`);
  for(const x of items){
    lines.push(`| ${String(x.item.title || '(untitled)').replace(/\|/g, '/')} | ${String(sessionProjectName(x.item)).replace(/\|/g, '/')} | ${n(x.usage.total || 0)} | ${cacheHitText(x.usage)} | ${compact(x.score)} | ${String(x.reason).replace(/\|/g, '/')} |`);
  }
  return lines.join('\n');
}
function renderSessionCacheGovernance(s){
  const items = sessionCacheGovernanceCandidates(s, 6);
  const stats = sessionCacheGovernanceStats(items);
  const maxScore = Math.max(1, ...items.map((x) => x.score || 0));
  const top = items[0];
  const body = items.length ? items.map((x, index) => {
    const key = sessionKeyFor(x.item);
    const hit = Math.max(0, Math.min(100, x.hit || 0));
    const scoreW = Math.max(5, Math.min(100, ((x.score || 0) / maxScore) * 100));
    return `<button class="cache-governance-row ${key === selectedSessionId ? 'active' : ''} ${x.health.tone}" data-session-select="${esc(key)}"><span class="cache-governance-rank">${index + 1}</span><span class="cache-governance-main"><b>${esc(x.item.title || '(untitled)')}</b><em>${esc(sessionProjectName(x.item))} / ${x.health.label}</em></span><span class="cache-governance-metrics"><strong>${compact(x.score)}</strong><small>${TXT.cacheHitRate} ${cacheHitText(x.usage)}</small></span><i style="--score:${scoreW}%; --hit:${hit}%"></i></button>`;
  }).join('') : `<div class="cache-governance-empty">${TXT.cacheGovernanceEmpty}</div>`;
  return `<section class="cache-governance"><div class="cache-governance-head"><div><b>${TXT.cacheGovernance}</b><span>${TXT.cacheGovernanceHint}</span></div><div class="cache-governance-actions"><button data-session-cache-governance="focus">${TXT.cacheGovernanceFocus}</button><button data-session-cache-governance="copy">${TXT.cacheGovernanceReport}</button></div></div><div class="cache-governance-kpis"><div><span>${TXT.cacheGovernanceTop}</span><b>${top ? esc(top.item.title || '(untitled)') : TXT.noData}</b><em>${top ? `${TXT.cacheOpportunityScore} ${compact(top.score)}` : TXT.cacheGovernanceEmpty}</em></div><div><span>${TXT.cacheGovernancePotential}</span><b>${compact(stats.potential)}</b><em>${TXT.cacheWastedTokens}</em></div><div><span>${TXT.cacheGovernanceWeighted}</span><b>${cacheHitText(stats.usage)}</b><em>${TXT.cacheHitBasis} ${cacheHitBasis(stats.usage)}</em></div><div><span>${TXT.cacheGovernanceCandidates}</span><b>${n(items.length)}</b><em>${TXT.visibleSessions}</em></div></div><div class="cache-governance-list">${body}</div></section>`;
}
function sessionCacheOpportunityHtml(s){
  const candidates = (s.sessions || [])
    .filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter) && sessionStatusMatches(item))
    .map((item) => ({ item, usage: item.usage || {}, hit: cacheHitRate(item.usage || {}) }))
    .filter((x) => Number(x.usage.total || 0) > 0 && (x.hit == null || x.hit < 35))
    .sort((a, b) => (b.usage.total || 0) - (a.usage.total || 0))
    .slice(0, 5);
  if(!candidates.length) return '';
  const max = Math.max(1, ...candidates.map((x) => x.usage.total || 0));
  return `<div class="session-cache-opportunities"><div class="session-rail-head"><b>${TXT.cacheOpportunities}</b><span>${TXT.cacheOpportunityHint}</span></div><div class="cache-opportunity-list">${candidates.map(({ item, usage, hit }) => { const key = sessionKeyFor(item); const health = cacheHealth(usage); return `<button data-session-select="${esc(key)}" class="${key === selectedSessionId ? 'active' : ''}"><span><b>${esc(item.title || '(untitled)')}</b><em>${esc(sessionProjectName(item))} / ${TXT.cacheHitRate} ${cacheHitText(usage)} / ${health.label}</em></span><strong>${compact(usage.total || 0)}</strong><i style="--w:${Math.max(5, Math.min(100, ((usage.total || 0) / max) * 100))}%; --hit:${Math.max(0, Math.min(100, hit || 0))}%"></i></button>`; }).join('')}</div></div>`;
}
eval(readRendererPart('dashboard/sessions/session-workspace.js'));
function renderRenameSheet(){
  if(!renameSessionKey || !snapshot?.ok) return '';
  const item = sessionByKey(renameSessionKey);
  if(!item) return '';
  const value = renameDraft || item.title || '';
  return `<div class="modal-backdrop" data-modal-backdrop="rename"><div class="rename-sheet" role="dialog" aria-modal="true" data-modal="rename"><div class="rename-head"><div><b>${TXT.renameTitle}</b><span>${esc(item.id || '')}</span></div><button data-rename-cancel="1">&#215;</button></div><label>${TXT.renameHint}<input data-rename-input value="${esc(value)}" /></label><div class="rename-actions"><button data-rename-cancel="1">${TXT.cancel}</button><button class="primary" data-rename-save="1">${TXT.save}</button></div></div></div>`;
}
function renderBulkMetaSheet(){
  if(!bulkMetaOpen) return '';
  const count = selectedSessionItems().length;
  return `<div class="modal-backdrop" data-modal-backdrop="bulk-meta"><div class="rename-sheet meta-sheet" role="dialog" aria-modal="true" data-modal="bulk-meta"><div class="rename-head"><div><b>${TXT.bulkMetaTitle}</b><span>${n(count)} ${TXT.session} 閻?${TXT.bulkMetaHint}</span></div><button data-bulk-meta-cancel="1">&#215;</button></div><label>${TXT.tagsPlaceholder}<input data-bulk-meta-tags value="${esc(bulkMetaTagsDraft)}" placeholder="${TXT.tagsPlaceholder}" /></label><label>${TXT.notePlaceholder}<textarea data-bulk-meta-note placeholder="${TXT.notePlaceholder}">${esc(bulkMetaNoteDraft)}</textarea></label><div class="rename-actions"><button data-bulk-meta-cancel="1">${TXT.cancel}</button><button class="primary" data-bulk-meta-save="1">${TXT.apply}</button></div></div></div>`;
}
function saveBulkMetaSheet(){
  const items = selectedSessionItems();
  const tags = normalizeTags(bulkMetaTagsDraft);
  const note = String(bulkMetaNoteDraft || '').trim();
  for(const item of items){
    const key = sessionKeyFor(item);
    const prev = sessionMeta[key] || { tags: [], note: '' };
    const mergedTags = [...new Set([...(prev.tags || []), ...tags])].slice(0, 12);
    const nextNote = note ? (prev.note ? `${prev.note}\n${note}` : note) : (prev.note || '');
    sessionMeta[key] = { tags: mergedTags, note: nextNote };
  }
  saveSessionMeta();
  bulkMetaOpen = false;
  bulkMetaTagsDraft = '';
  bulkMetaNoteDraft = '';
  setRefreshState(TXT.savedLocal);
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => setRefreshState(''), 900);
  if(snapshot?.ok) render(snapshot);
}
async function saveRenameSheet(){
  const item = sessionByKey(renameSessionKey);
  const next = String(renameDraft || '').trim();
  if(!item || !next) return;
  setRefreshState(TXT.refresh);
  await ipcRenderer.invoke('dashboard:renameSession', item, next);
  renameSessionKey = '';
  renameDraft = '';
  await refreshNow();
}
