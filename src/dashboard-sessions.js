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
function sessionTopModel(session){ const model = session?.usage?.topModel; if(!model) return 'N/A'; return shortModel(model.model || model.key || 'unknown'); }
function findSelectedSession(){ return sessionTableItems.find((x) => sessionKeyFor(x) === selectedSessionId) || sessionTableItems[0] || null; }
function saveSelectedSessions(){ localStorage.setItem('selectedSessionKeys', [...selectedSessionKeys].join('|')); }
function savePinnedSessions(){ localStorage.setItem('pinnedSessionKeys', [...pinnedSessionKeys].join('|')); }
function sessionByKey(key){ return (snapshot?.sessions || []).find((x) => sessionKeyFor(x) === key) || sessionTableItems.find((x) => sessionKeyFor(x) === key) || null; }
function selectedSessionItems(){ return [...selectedSessionKeys].map(sessionByKey).filter(Boolean); }
function isPinnedSession(item){ return pinnedSessionKeys.has(sessionKeyFor(item)); }
function compactPath(value){ const text = String(value || ''); if(text.length <= 42) return text; return `...${text.slice(-39)}`; }
function sessionRequests(item){ if(!item || !snapshot?.requestLog) return []; return snapshot.requestLog.filter((r) => r.sessionId === item.id && sourceKey(r) === sourceKey(item)).sort((a, b) => (b.time || 0) - (a.time || 0)); }
function sessionSummaryText(item){ const u = item.usage || {}; const reqs = sessionRequests(item).slice(0, 6).map((r) => `- ${dateLabel(r.time)} ${shortModel(r.model)} ${n(r.total)} token TTFT ${ms(r.ttftMs)}`).join('\n'); return [`${item.title || '(untitled)'}`, `ID: ${item.id || ''}`, `${TXT.source}: ${sourceName(item)}`, `${TXT.status}: ${item.archived ? TXT.archived : TXT.active}`, `${TXT.directory}: ${item.directory || ''}`, `${TXT.total}: ${n(u.total || 0)} token`, `${TXT.input}: ${n(u.input || 0)} / ${TXT.output}: ${n(u.output || 0)}`, `${TXT.cacheWrite}: ${n(u.cacheWrite || 0)} / ${TXT.cacheRead}: ${n(u.cacheRead || 0)} / ${TXT.cacheHitRate}: ${cacheHitText(u)}`, `${TXT.turns}: ${n(u.userTurns || 0)} / ${TXT.calls}: ${n(u.modelCalls || 0)}`, `${TXT.topModel}: ${sessionTopModel(item)}`, reqs ? `${TXT.requestDetails}:\n${reqs}` : `${TXT.requestDetails}: ${TXT.noRequests}`].join('\n'); }
function sessionMarkdown(item){
  const u = item.usage || {};
  const models = (u.models || []).map((m) => `| ${shortModel(m.model || m.key || 'unknown')} | ${m.provider || ''} | ${n(m.calls || 0)} | ${n(m.total || 0)} | ${n(m.input || 0)} | ${n(m.output || 0)} |`).join('\n') || '| N/A |  | 0 | 0 | 0 | 0 |';
  const reqs = sessionRequests(item).map((r) => `| ${dateLabel(r.time)} | ${shortModel(r.model)} | ${n(r.total)} | ${ms(r.ttftMs)} | ${ms(r.latencyMs)} | ${rate(r.outputTokensPerSec)} | ${r.ok ? '200' : r.status} |`).join('\n') || '| N/A | N/A | 0 | N/A | N/A | N/A | N/A |';
  return [
    `# ${item.title || '(untitled)'}`,
    '',
    `- ID: ${item.id || ''}`,
    `- ${TXT.source}: ${sourceName(item)}`,
    `- ${TXT.status}: ${item.archived ? TXT.archived : TXT.active}`,
    `- ${TXT.directory}: ${item.directory || ''}`,
    `- ${TXT.updated}: ${dateLabel(item.updatedAt)}`,
    '',
    `## ${TXT.tokenBreakdown}`,
    '',
    `| ${TXT.total} | ${TXT.input} | ${TXT.output} | ${TXT.cacheWrite} | ${TXT.cacheRead} | ${TXT.cacheHitRate} | ${TXT.turns} | ${TXT.calls} |`,
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${n(u.total || 0)} | ${n(u.input || 0)} | ${n(u.output || 0)} | ${n(u.cacheWrite || 0)} | ${n(u.cacheRead || 0)} | ${cacheHitText(u)} | ${n(u.userTurns || 0)} | ${n(u.modelCalls || 0)} |`,
    '',
    `## ${TXT.modelBreakdown}`,
    '',
    `| ${TXT.model} | ${TXT.provider} | ${TXT.calls} | ${TXT.total} | ${TXT.input} | ${TXT.output} |`,
    '|---|---|---:|---:|---:|---:|',
    models,
    '',
    `## ${TXT.requestTimeline}`,
    '',
    `| ${TXT.time} | ${TXT.model} | ${TXT.total} | ${TXT.ttft} | ${TXT.wait} | ${TXT.speed} | ${TXT.status} |`,
    '|---|---|---:|---:|---:|---:|---|',
    reqs,
  ].join('\n');
}
function csvEscape(value){ const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function sessionCsv(items){
  const head = [TXT.updated, TXT.source, TXT.session, 'ID', TXT.status, TXT.total, TXT.input, TXT.output, TXT.cacheWrite, TXT.cacheRead, TXT.cacheHitRate, TXT.turns, TXT.calls, TXT.topModel, TXT.directory, TXT.notesTags];
  const rows = items.map((item) => {
    const u = item.usage || {};
    const meta = metaForSession(item);
    return [dateLabel(item.updatedAt), sourceName(item), item.title || '', item.id || '', item.archived ? TXT.archived : TXT.active, u.total || 0, u.input || 0, u.output || 0, u.cacheWrite || 0, u.cacheRead || 0, cacheHitText(u), u.userTurns || 0, u.modelCalls || 0, sessionTopModel(item), item.directory || '', [...(meta.tags || []), meta.note || ''].filter(Boolean).join(' | ')];
  });
  return [head, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}
function sessionStat(label, value){ return `<div class="session-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
function sessionEfficiencyHtml(item){
  const u = item?.usage || {};
  const reqs = sessionRequests(item);
  const hit = cacheHitRate(u);
  const health = cacheHealth(u);
  const avgWait = avg(reqs.map((r) => r.latencyMs).filter(Number.isFinite));
  const avgTtft = avg(reqs.map((r) => r.ttftMs).filter(Number.isFinite));
  const density = Number(u.userTurns || 0) > 0 ? (Number(u.total || 0) / Math.max(1, Number(u.userTurns || 0))) : 0;
  return `<div class="session-efficiency ${health.tone}"><div><span>${TXT.cacheHealth}</span><b>${health.label}</b><em>${TXT.cacheHitRate} ${cacheHitText(u)}</em></div><div><span>${TXT.wait}</span><b>${ms(avgWait)}</b><em>${TXT.ttft} ${ms(avgTtft)}</em></div><div><span>Token / turn</span><b>${compact(density)}</b><em>${n(u.userTurns || 0)} ${TXT.turns}</em></div><i style="--w:${Math.max(4, Math.min(100, hit || 0))}%"></i></div>`;
}
function sessionRequestList(item){ const reqs = sessionRequests(item).slice(0, 8); if(!reqs.length) return `<div class="request-empty">${TXT.noRequests}</div>`; return `<div class="request-list">${reqs.map((r) => { const key = requestKeyFor(r); return `<button class="request-item" data-request-select="${esc(key)}" data-table="requests"><div><b>${esc(dateLabel(r.time))}</b><span>${esc(shortModel(r.model))} / ${esc(r.provider || '')}</span></div><div><strong>${compact(r.total || 0)}</strong><span>${TXT.ttft} ${ms(r.ttftMs)} / ${TXT.cacheHitRate} ${cacheHitText(r)}</span></div></button>`; }).join('')}</div>`; }
function sessionModelBreakdown(item){
  const models = (item?.usage?.models || []).slice(0, 6);
  if(!models.length) return `<div class="request-empty">${TXT.noData}</div>`;
  const max = Math.max(1, ...models.map((m) => m.total || 0));
  return `<div class="model-breakdown">${models.map((m) => `<div class="model-break-row"><div><b>${esc(shortModel(m.model || m.key || 'unknown'))}</b><span>${esc(m.provider || '')} / ${n(m.calls || 0)} ${TXT.calls} / ${TXT.cacheHitRate} ${cacheHitText(m)}</span></div><strong>${compact(m.total || 0)}</strong><i style="--w:${Math.max(3, Math.min(100, ((m.total || 0) / max) * 100))}%"></i></div>`).join('')}</div>`;
}
function sessionTokenStackHtml(u){
  return `<div class="token-stack"><i style="--w:${Math.max(2, Math.min(100, ((u.input || 0) / Math.max(1, u.total || 1)) * 100))}%; --c:${COLORS.input}"></i><i style="--w:${Math.max(2, Math.min(100, ((u.output || 0) / Math.max(1, u.total || 1)) * 100))}%; --c:${COLORS.output}"></i><i style="--w:${Math.max(2, Math.min(100, ((u.cacheWrite || 0) / Math.max(1, u.total || 1)) * 100))}%; --c:${COLORS.cacheWrite}"></i><i style="--w:${Math.max(2, Math.min(100, ((u.cacheRead || 0) / Math.max(1, u.total || 1)) * 100))}%; --c:${COLORS.cacheRead}"></i></div>`;
}
function renderSessionEssentialInspector(item, selectedKey){
  const u = item.usage || {};
  const archived = Boolean(item.archived);
  const pinned = isPinnedSession(item);
  const meta = metaForSession(item);
  const tagValue = (meta.tags || []).join(', ');
  return `<aside class="session-inspector session-essential-inspector"><div class="inspector-head session-essential-head"><div><div class="inspector-title">${TXT.selectedSession}</div><h3>${esc(item.title || '(untitled)')}</h3><p>${esc(item.id || '')}</p></div><div class="session-badges"><span class="session-state ${archived ? 'archived' : 'live'}">${archived ? TXT.archived : TXT.active}</span>${pinned ? `<span class="session-state pinned-state">${TXT.pinned}</span>` : ''}</div></div><div class="session-essential-summary session-essential-summary-lean"><div class="session-essential-meta"><div><span>${TXT.total}</span><b>${compact(u.total || 0)}</b></div><div><span>${TXT.updated}</span><b>${esc(dateLabel(item.updatedAt))}</b></div><div><span>${TXT.turns}</span><b>${n(u.userTurns || 0)}</b></div><div><span>${TXT.topModel}</span><b>${esc(sessionTopModel(item))}</b></div></div></div><div class="session-essential-actions inspector-actions"><button class="primary-action" data-session-action="open" data-session-key="${esc(selectedKey)}">${TXT.open}</button><button data-session-action="copy-summary" data-session-key="${esc(selectedKey)}">${TXT.copySummary}</button><button data-session-action="rename" data-session-key="${esc(selectedKey)}">${TXT.rename}</button><button data-session-pin="${esc(selectedKey)}">${pinned ? TXT.unpin : TXT.pin}</button><button class="dangerless" data-session-action="archive" data-session-key="${esc(selectedKey)}" data-archive="${archived ? 'false' : 'true'}">${archived ? TXT.restore : TXT.archive}</button></div><div class="inspector-block session-essential-save"><span>${TXT.notesTags} &#183; ${TXT.save}</span><div class="session-meta-editor"><div class="session-tags-preview">${sessionTagsHtml(item, 6)}</div><input data-session-tags="${esc(selectedKey)}" value="${esc(tagValue)}" placeholder="${TXT.tagsPlaceholder}" /><textarea data-session-note="${esc(selectedKey)}" placeholder="${TXT.notePlaceholder}">${esc(meta.note || '')}</textarea><small>${TXT.savedLocal}</small></div></div><div class="session-essential-foot"><span>${TXT.directory}</span><code title="${esc(item.directory || '')}">${esc(item.directory ? compactPath(item.directory) : 'N/A')}</code><button data-session-advanced-toggle="1">${TXT.showAdvanced}</button></div></aside>`;
}
function renderSessionAdvancedInspector(item, selectedKey){
  const u = item.usage || {};
  const archived = Boolean(item.archived);
  const pinned = isPinnedSession(item);
  const reqs = sessionRequests(item);
  const requestCount = reqs.length;
  const meta = metaForSession(item);
  const tagValue = (meta.tags || []).join(', ');
  return `<aside class="session-inspector session-advanced-inspector"><div class="inspector-head"><div><div class="inspector-title">${TXT.selectedSession}</div><h3>${esc(item.title || '(untitled)')}</h3><p>${esc(item.id || '')}</p></div><div class="session-badges"><span class="session-state ${archived ? 'archived' : 'live'}">${archived ? TXT.archived : TXT.active}</span>${pinned ? `<span class="session-state pinned-state">${TXT.pinned}</span>` : ''}</div></div><div class="inspector-grid">${sessionStat(TXT.total, compact(u.total || 0))}${sessionStat(TXT.input, compact(u.input || 0))}${sessionStat(TXT.output, compact(u.output || 0))}${sessionStat(TXT.cacheWrite, compact(u.cacheWrite || 0))}${sessionStat(TXT.cacheRead, compact(u.cacheRead || 0))}${sessionStat(TXT.cacheHitRate, cacheHitText(u))}${sessionStat(TXT.turns, n(u.userTurns || 0))}${sessionStat(TXT.calls, n(u.modelCalls || 0))}${sessionStat(TXT.requests, n(requestCount))}${sessionStat(TXT.ttft, ms(avg(reqs.map((r) => r.ttftMs).filter(Number.isFinite))))}${sessionStat(TXT.wait, ms(avg(reqs.map((r) => r.latencyMs).filter(Number.isFinite))))}</div><div class="inspector-block"><span>${TXT.cacheHealth}</span>${sessionEfficiencyHtml(item)}</div><div class="inspector-block"><span>${TXT.notesTags}</span><div class="session-meta-editor"><div class="session-tags-preview">${sessionTagsHtml(item, 8)}</div><input data-session-tags="${esc(selectedKey)}" value="${esc(tagValue)}" placeholder="${TXT.tagsPlaceholder}" /><textarea data-session-note="${esc(selectedKey)}" placeholder="${TXT.notePlaceholder}">${esc(meta.note || '')}</textarea></div></div><div class="inspector-block"><span>${TXT.directory}</span><code>${esc(item.directory || 'N/A')}</code></div><div class="inspector-block cache-inspector-block"><span>${TXT.cacheEfficiency}</span>${cacheEfficiencyPanel(u, 'inspector-cache')}</div><div class="inspector-block"><span>${TXT.tokenBreakdown}</span>${sessionTokenStackHtml(u)}</div><div class="inspector-block"><span>${TXT.modelBreakdown}</span>${sessionModelBreakdown(item)}</div><div class="inspector-block"><span>${TXT.requestTimeline}</span>${sessionRequestList(item)}</div><div class="inspector-actions"><button class="primary-action" data-session-action="focus-requests" data-session-key="${esc(selectedKey)}">${TXT.viewRequests}</button><button data-session-action="open-codearts" data-session-key="${esc(selectedKey)}">${TXT.openCodeArts}</button><button data-session-action="open" data-session-key="${esc(selectedKey)}">${TXT.open}</button><button data-session-action="rename" data-session-key="${esc(selectedKey)}">${TXT.rename}</button><button data-session-pin="${esc(selectedKey)}">${pinned ? TXT.unpin : TXT.pin}</button><button data-session-action="copy-markdown" data-session-key="${esc(selectedKey)}">${TXT.copyMarkdown}</button><button data-session-action="copy-requests-json" data-session-key="${esc(selectedKey)}">${TXT.copyRequestJson}</button><button data-session-action="copy-summary" data-session-key="${esc(selectedKey)}">${TXT.copySummary}</button><button data-session-action="copy-id" data-session-key="${esc(selectedKey)}">${TXT.copyId}</button><button data-session-action="copy-path" data-session-key="${esc(selectedKey)}">${TXT.copyPath}</button><button data-session-action="copy-json" data-session-key="${esc(selectedKey)}">${TXT.sessionJson}</button><button class="dangerless" data-session-action="archive" data-session-key="${esc(selectedKey)}" data-archive="${archived ? 'false' : 'true'}">${archived ? TXT.restore : TXT.archive}</button></div></aside>`;
}
function renderSessionInspector(){
  const item = findSelectedSession();
  if(!item) return `<aside class="session-inspector empty"><div class="inspector-title">${TXT.selectedSession}</div><p>${TXT.noSessionSelected}</p></aside>`;
  selectedSessionId = sessionKeyFor(item);
  localStorage.setItem('selectedSessionId', selectedSessionId);
  return renderSessionEssentialInspector(item, selectedSessionId);
}
function sessionOverviewHtml(s){
  const all = (s.sessions || []).filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter));
  const active = all.filter((item) => !item.archived).length;
  const archived = all.filter((item) => item.archived).length;
  const tagged = all.filter((item) => (metaForSession(item).tags || []).length || metaForSession(item).note).length;
  const pinned = all.filter(isPinnedSession).length;
  const visible = sessionTableItems.length;
  const st = all.reduce((acc, item) => addSessionUsage(acc, item.usage || {}), { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, calls: 0 });
  return `<div class="session-overview session-overview-lean"><div class="session-overview-card strong"><span>${TXT.visibleSessions}</span><b>${n(visible)}</b><em>${TXT.allSessions} ${n(all.length)}</em></div><div class="session-overview-card"><span>${TXT.activeSessions}</span><b>${n(active)}</b><em>${TXT.archivedSessions} ${n(archived)}</em></div><div class="session-overview-card"><span>${TXT.pinnedSessions}</span><b>${n(pinned)}</b><em>${TXT.taggedSessions} ${n(tagged)}</em></div><div class="session-overview-card"><span>${TXT.total}</span><b>${compact(st.total || 0)}</b><em>${n(st.turns || 0)} ${TXT.turns}</em></div></div>`;
}
function addSessionUsage(acc, u){
  acc.total += Number(u.total || 0);
  acc.input += Number(u.input || 0);
  acc.output += Number(u.output || 0);
  acc.cacheRead += Number(u.cacheRead || 0);
  acc.cacheWrite += Number(u.cacheWrite || 0);
  acc.turns += Number(u.userTurns || 0);
  acc.calls += Number(u.modelCalls || 0);
  return acc;
}
function sessionRowHtml(x, detailed = false){
  const u = x.usage || {};
  const key = sessionKeyFor(x);
  const selected = key === selectedSessionId;
  const checked = selectedSessionKeys.has(key);
  const pinned = isPinnedSession(x);
  const commonStart = `<tr class="session-row ${selected ? 'selected' : ''} ${pinned ? 'pinned' : ''}" data-session-select="${esc(key)}"><td class="check-col"><input type="checkbox" data-session-check="${esc(key)}" ${checked ? 'checked' : ''}></td><td class="pin-col"><button class="pin-btn ${pinned ? 'active' : ''}" data-session-pin="${esc(key)}" title="${pinned ? TXT.unpin : TXT.pin}">${pinned ? '&#9733;' : '&#9734;'}</button></td><td>${esc(dateLabel(x.updatedAt))}</td><td><span class="source-pill">${esc(sourceName(x))}</span></td><td><b>${esc(x.title || '(untitled)')}</b>${pinned ? `<span class="pin-label">${TXT.pinned}</span>` : ''}<span class="project-chip" title="${esc(x.directory || '')}">${esc(sessionProjectName(x))}</span><div class="muted">${esc(x.id)}</div></td><td>${sessionTagsHtml(x, 3)}</td>`;
  if(detailed){
    return `${commonStart}<td><b>${n(u.total)}</b></td><td>${n(u.input)}</td><td>${n(u.output)}</td><td class="cache-cell">${cachePillHtml(u)}</td><td>${n(u.userTurns)}</td><td>${n(u.modelCalls)}</td><td><code>${esc(sessionTopModel(x))}</code></td><td class="${x.archived ? 'muted' : 'ok'}">${x.archived ? TXT.archived : TXT.active}</td><td><div class="path-cell" title="${esc(x.directory || '')}">${esc(compactPath(x.directory || ''))}</div></td></tr>`;
  }
  return `${commonStart}<td><b>${n(u.total)}</b></td><td class="${x.archived ? 'muted' : 'ok'}">${x.archived ? TXT.archived : TXT.active}</td><td class="session-actions-cell"><div class="session-row-actions"><button data-session-action="copy-summary" data-session-key="${esc(key)}" title="${TXT.copySummary}">${TXT.copy}</button><button data-session-action="open" data-session-key="${esc(key)}" title="${TXT.open}">${TXT.open}</button><button data-session-action="archive" data-session-key="${esc(key)}" data-archive="${x.archived ? 'false' : 'true'}" title="${x.archived ? TXT.restore : TXT.archive}">${x.archived ? TXT.restore : TXT.archive}</button></div></td></tr>`;
}
function sessionLimitNote(rendered, total){
  return rendered < total ? `<div class="table-limit-note" data-table-limit="sessions" data-rendered="${rendered}" data-total="${total}">\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} \u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22 / \u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002</div>` : '';
}
function sessionTable(s){
  const tableStartedAt = perfNow();
  const filtered = sortSessions((s.sessions || []).filter(sessionMatches));
  const limit = Math.max(80, Number(sessionTableRenderLimit || 80));
  const list = filtered.slice(0, limit);
  sessionTableItems = list;
  for(const key of [...selectedSessionKeys]) if(!filtered.some((x) => sessionKeyFor(x) === key)) selectedSessionKeys.delete(key);
  saveSelectedSessions();
  if(selectedSessionId && !filtered.some((x) => sessionKeyFor(x) === selectedSessionId)) selectedSessionId = '';
  if(!selectedSessionId && list[0]) selectedSessionId = sessionKeyFor(list[0]);
  const allChecked = list.length && list.every((x) => selectedSessionKeys.has(sessionKeyFor(x)));
  const detailed = false;
  const head = detailed
    ? `<tr><th class="check-col"><input type="checkbox" data-session-check-all ${allChecked ? 'checked' : ''}></th><th></th><th>${TXT.updated}</th><th>${TXT.source}</th><th>${TXT.session}</th><th>${TXT.notesTags}</th><th>${TXT.total}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheHitRate}</th><th>${TXT.turns}</th><th>${TXT.calls}</th><th>${TXT.topModel}</th><th>${TXT.status}</th><th>${TXT.directory}</th></tr>`
    : `<tr><th class="check-col"><input type="checkbox" data-session-check-all ${allChecked ? 'checked' : ''}></th><th></th><th>${TXT.updated}</th><th>${TXT.source}</th><th>${TXT.session}</th><th>${TXT.notesTags}</th><th>${TXT.total}</th><th>${TXT.status}</th><th></th></tr>`;
  const body = list.length ? list.map((x) => sessionRowHtml(x, detailed)).join('') : emptyRow(detailed ? 15 : 9);
  const rows = `<div class="table-scroll session-scroll"><table class="session-table ${detailed ? 'detailed' : 'simple'}"><thead>${head}</thead><tbody>${body}</tbody></table></div>${sessionLimitNote(list.length, filtered.length)}`;
  const html = `<div class="session-manager"><div class="session-main">${rows}</div>${renderSessionInspector()}</div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
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
function renderSessionWorkspace(s){
  tableTab = 'sessions';
  localStorage.setItem('statsTableTab', tableTab);
  const content = sessionTable(s);
  const tool = sessionBulkHtml(false);
  const count = sessionTableItems.length;
  return `${sessionOverviewHtml(s)}${sessionSimpleToolbarHtml(s)}${sessionFilterContextHtml(s)}${sessionAdvancedHtml(s)}<section class="table-card session-workspace-card"><div class="table-toolbar session-toolbar"><input data-query="sessions" value="${esc(sessionQuery)}" placeholder="${TXT.sessionSearch}" />${tool}<span class="muted row-count">${n(count)} ${TXT.rows}</span></div>${content}</section>${renderRenameSheet()}${renderBulkMetaSheet()}`;
}
function renderTable(rows, s){ if(tableTab === 'sessions') tableTab = 'requests'; let content; if(tableTab === 'requests') content = tableRows(rows); else if(tableTab === 'providers') content = statTable(groupBy(applyTableSearch(rows), (r) => r.provider), TXT.provider); else content = statTable(groupBy(applyTableSearch(rows), (r) => r.model), TXT.model); const tabs = [['requests', TXT.reqLog], ['providers', TXT.providerStats], ['models', TXT.modelStats]]; const count = applyTableSearch(rows).length; return `<div class="table-tabs">${tabs.map(([k, label]) => `<button data-table="${k}" class="${tableTab === k ? 'active' : ''}"><span class="tab-mark"></span>${esc(label)}</button>`).join('')}<button data-workspace="sessions" class="workspace-jump"><span class="tab-mark"></span>${TXT.sessionManage}</button></div><section class="table-card"><div class="table-toolbar"><input data-query="analytics" value="${esc(analyticsQuery)}" placeholder="${TXT.search}" /><span class="muted row-count">${n(count)} ${TXT.rows}</span></div>${content}</section>`; }
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
