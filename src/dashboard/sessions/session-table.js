function sessionOverviewHtml(s){
  const sessionCount = Array.isArray(s?.sessions) ? s.sessions.length : 0;
  const summary = s?.sessionSummary || {};
  const shouldUseSummary = sessionCount > 1200;
  if(shouldUseSummary){
    const total = Number(summary.total || s.sessionTotal || sessionCount || 0);
    const active = Number(summary.active ?? (sessionStatusFilter === 'archived' ? 0 : total));
    const archived = Number(summary.archived || 0);
    const tagged = Object.values(sessionMeta || {}).filter((meta) => (meta?.tags || []).length || meta?.note).length;
    const pinned = pinnedSessionKeys?.size || 0;
    const usage = s?.usage?.all || s?.usage?.week || {};
    return `<div class="session-overview session-overview-lean"><div class="session-overview-card strong"><span>${TXT.visibleSessions}</span><b>${n(sessionTableItems.length)}</b><em>${TXT.allSessions} ${n(total)}</em></div><div class="session-overview-card"><span>${TXT.activeSessions}</span><b>${n(active)}</b><em>${TXT.archivedSessions} ${n(archived)}</em></div><div class="session-overview-card"><span>${TXT.pinnedSessions}</span><b>${n(pinned)}</b><em>${TXT.taggedSessions} ${n(tagged)}</em></div><div class="session-overview-card"><span>${TXT.total}</span><b>${compact(usage.total || 0)}</b><em>${n(usage.messages || usage.requests || 0)} ${TXT.turns}</em></div></div>`;
  }
  const all = (s.sessions || []).filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter) && (typeof sessionRangeMatches !== 'function' || sessionRangeMatches(item, s)));
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
function sessionRowHtml(x){
  const u = x.usage || {};
  const key = sessionKeyFor(x);
  const selected = key === selectedSessionId;
  const checked = selectedSessionKeys.has(key);
  const pinned = isPinnedSession(x);
  return `<tr class="session-row ${selected ? 'selected' : ''} ${pinned ? 'pinned' : ''}" data-session-select="${esc(key)}"><td class="check-col"><input type="checkbox" data-session-check="${esc(key)}" ${checked ? 'checked' : ''}></td><td class="pin-col"><button class="pin-btn ${pinned ? 'active' : ''}" data-session-pin="${esc(key)}" title="${pinned ? TXT.unpin : TXT.pin}">${pinned ? '&#9733;' : '&#9734;'}</button></td><td>${esc(dateLabel(x.updatedAt))}</td><td><span class="source-pill">${esc(sourceName(x))}</span></td><td><b>${esc(x.title || TXT.untitled)}</b>${pinned ? `<span class="pin-label">${TXT.pinned}</span>` : ''}<span class="project-chip" title="${esc(x.directory || '')}">${esc(sessionProjectName(x))}</span><div class="muted">${esc(x.id)}</div></td><td>${sessionTagsHtml(x, 3)}</td><td><b>${n(u.total)}</b></td><td class="${x.archived ? 'muted' : 'ok'}">${x.archived ? TXT.archived : TXT.active}</td><td class="session-actions-cell"><div class="session-row-actions"><button data-session-action="copy-summary" data-session-key="${esc(key)}" title="${TXT.copySummary}">${TXT.copy}</button><button data-session-action="open" data-session-key="${esc(key)}" title="${TXT.open}">${TXT.open}</button><button data-session-action="archive" data-session-key="${esc(key)}" data-archive="${x.archived ? 'false' : 'true'}" title="${x.archived ? TXT.restore : TXT.archive}">${x.archived ? TXT.restore : TXT.archive}</button></div></td></tr>`;
}
function sessionLimitNote(rendered, total){
  if(typeof tablePaginationHtml === 'function') return tablePaginationHtml('sessions', rendered, total, sessionTablePage, SESSION_PAGE_SIZE);
  return '';
}
function shouldDeferSessionDbFallback(s, dbPage){
  if(dbPage?.paged || typeof canUseDbSessionPage !== 'function' || !canUseDbSessionPage()) return false;
  const inMemory = Array.isArray(s?.sessions) ? s.sessions.length : 0;
  const totalHint = Number(s?.sessionTotal || s?.sessionSummary?.active || s?.sessionSummary?.total || inMemory || 0);
  return inMemory > 1200 || totalHint > inMemory || sessionTablePage > 0;
}
function sessionTableLoadingHtml(total){
  sessionTableItems = [];
  const head = `<tr><th class="check-col"><input type="checkbox" data-session-check-all disabled></th><th></th><th>${TXT.updated}</th><th>${TXT.source}</th><th>${TXT.session}</th><th>${TXT.notesTags}</th><th>${TXT.total}</th><th>${TXT.status}</th><th></th></tr>`;
  const loading = `<div class="session-row-loading">${TXT.loading || '正在加载'} ${n(Math.min(SESSION_PAGE_SIZE, Math.max(0, Number(total || 0))))} / ${n(total || 0)} ${TXT.rows}</div>`;
  const rows = `<div class="table-scroll session-scroll"><table class="session-table simple"><thead>${head}</thead><tbody></tbody></table>${loading}</div>${sessionLimitNote(0, total)}`;
  return `<div class="session-manager"><div id="sessionTableSlot" class="session-main">${rows}</div><div id="sessionInspectorSlot">${renderSessionInspector()}</div></div>`;
}
function resetSessionPaging(){
  sessionTablePage = 0;
  sessionTableRenderLimit = SESSION_PAGE_SIZE;
  if(typeof invalidateSessionPageCache === 'function') invalidateSessionPageCache();
  localStorage.setItem('sessionTablePage', '0');
}
function sessionTable(s, opts = {}){
  const tableStartedAt = perfNow();
  const limit = SESSION_PAGE_SIZE;
  const dbPage = typeof sessionPageRowsForCurrentView === 'function' ? sessionPageRowsForCurrentView(s) : null;
  if(shouldDeferSessionDbFallback(s, dbPage)){
    const total = Number(s?.sessionTotal || s?.sessionSummary?.total || (s.sessions || []).length || 0);
    if(typeof scheduleSessionPageRefresh === 'function') scheduleSessionPageRefresh(s, sessionTablePage);
    const html = sessionTableLoadingHtml(total);
    markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
    return html;
  }
  const filtered = dbPage?.paged ? sortSessions((dbPage.list || []).filter(sessionMatches)) : sortSessions((s.sessions || []).filter(sessionMatches));
  const total = dbPage?.paged ? Math.max(Number(dbPage.total || 0), filtered.length) : filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  sessionTablePage = Math.max(0, Math.min(totalPages - 1, Number(sessionTablePage || 0)));
  localStorage.setItem('sessionTablePage', String(sessionTablePage));
  const start = sessionTablePage * limit;
  const list = dbPage?.paged ? filtered.slice(0, limit) : filtered.slice(start, start + limit);
  sessionTableRenderLimit = limit;
  sessionTableItems = list;
  const visibleKeys = new Set(list.map(sessionKeyFor));
  for(const key of [...selectedSessionKeys]) if(dbPage?.paged ? !visibleKeys.has(key) : !filtered.some((x) => sessionKeyFor(x) === key)) selectedSessionKeys.delete(key);
  saveSelectedSessions();
  if(selectedSessionId && (dbPage?.paged ? !visibleKeys.has(selectedSessionId) : !filtered.some((x) => sessionKeyFor(x) === selectedSessionId))) selectedSessionId = '';
  if(!selectedSessionId && list[0]) selectedSessionId = sessionKeyFor(list[0]);
  const allChecked = list.length && list.every((x) => selectedSessionKeys.has(sessionKeyFor(x)));
  const head = `<tr><th class="check-col"><input type="checkbox" data-session-check-all ${allChecked ? 'checked' : ''}></th><th></th><th>${TXT.updated}</th><th>${TXT.source}</th><th>${TXT.session}</th><th>${TXT.notesTags}</th><th>${TXT.total}</th><th>${TXT.status}</th><th></th></tr>`;
  const deferRows = opts.deferRows === true && list.length > 18;
  if(deferRows){
    sessionHydrationItems = list;
    sessionHydrationToken += 1;
  }
  const body = deferRows ? '' : (list.length ? list.map(sessionRowHtml).join('') : emptyRow(9));
  const bodyAttrs = deferRows ? ' data-session-deferred="1"' : '';
  const rows = `<div class="table-scroll session-scroll"><table class="session-table simple"><thead>${head}</thead><tbody${bodyAttrs}>${body}</tbody></table>${deferRows ? `<div class="session-row-loading">${TXT.loading || '正在加载'} ${n(list.length)} ${TXT.rows}</div>` : ''}</div>${sessionLimitNote(list.length, total)}`;
  const html = `<div class="session-manager"><div id="sessionTableSlot" class="session-main">${rows}</div><div id="sessionInspectorSlot">${renderSessionInspector()}</div></div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
}
