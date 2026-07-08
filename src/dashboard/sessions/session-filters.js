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
