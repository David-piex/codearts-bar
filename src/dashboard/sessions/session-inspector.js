function sessionTopModel(session){ const model = session?.usage?.topModel; if(!model) return emptyMetric(); return shortModel(model.model || model.key || TXT.unknown); }
function findSelectedSession(){ return sessionTableItems.find((x) => sessionKeyFor(x) === selectedSessionId) || sessionTableItems[0] || null; }
function rememberSelectedSessions(items = []){
  for(const item of items || []){
    const key = sessionKeyFor(item);
    if(key && selectedSessionKeys.has(key)) selectedSessionRecords.set(key, item);
  }
  for(const key of [...selectedSessionRecords.keys()]) if(!selectedSessionKeys.has(key)) selectedSessionRecords.delete(key);
}
function saveSelectedSessions(){
  rememberSelectedSessions(sessionTableItems || []);
  localStorage.setItem('selectedSessionKeys', [...selectedSessionKeys].join('|'));
}
function clearSelectedSessions(){
  selectedSessionKeys.clear();
  selectedSessionRecords.clear();
  localStorage.setItem('selectedSessionKeys', '');
}
function savePinnedSessions(){ localStorage.setItem('pinnedSessionKeys', [...pinnedSessionKeys].join('|')); }
function sessionByKey(key){ return (snapshot?.sessions || []).find((x) => sessionKeyFor(x) === key) || sessionTableItems.find((x) => sessionKeyFor(x) === key) || selectedSessionRecords.get(key) || null; }
function selectedSessionItems(){
  if(!selectedSessionKeys?.size) return [];
  const out = [];
  const seen = new Set();
  const addIfSelected = (item) => {
    if(!item) return;
    const key = sessionKeyFor(item);
    if(!selectedSessionKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  for(const item of sessionTableItems || []) addIfSelected(item);
  if(seen.size < selectedSessionKeys.size) for(const item of snapshot?.sessions || []) addIfSelected(item);
  if(seen.size < selectedSessionKeys.size) for(const item of selectedSessionRecords.values()) addIfSelected(item);
  return out;
}
function isPinnedSession(item){ return pinnedSessionKeys.has(sessionKeyFor(item)); }
function compactPath(value){ const text = String(value || ''); if(text.length <= 42) return text; return `...${text.slice(-39)}`; }
function sessionRequestPageKey(item, limit = 80, offset = 0){
  if(!item) return '';
  return `${sourceKey(item)}:${item.id || ''}:${Number(limit || 80)}:${Number(offset || 0)}:${item.dbPath || ''}`;
}
function normalizeSessionRequestPayload(item, limit = 80, offset = 0){
  const src = sourceKey(item);
  return {
    sessionId: item?.id || '',
    source: src && src !== 'unknown' ? src : 'all',
    dbPath: item?.dbPath || undefined,
    limit: Math.max(1, Math.min(500, Number(limit || 80))),
    offset: Math.max(0, Number(offset || 0)),
  };
}
function cachedSessionRequests(item, limit = 80){
  const prefix = `${sourceKey(item)}:${item?.id || ''}:`;
  const cached = [...(sessionRequestPageCache?.entries?.() || [])]
    .filter(([key]) => key.startsWith(prefix))
    .sort(([, a], [, b]) => Number(a?.offset || 0) - Number(b?.offset || 0))
    .flatMap(([, page]) => Array.isArray(page?.items) ? page.items : []);
  if(!cached.length) return [];
  const seen = new Set();
  const out = [];
  for(const row of cached.sort((a, b) => (b.time || 0) - (a.time || 0))){
    const key = requestKeyFor(row);
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if(out.length >= limit) break;
  }
  return out;
}
async function loadSessionRequestsPage(item, limit = 80, offset = 0){
  if(!item?.id || typeof ipcRenderer?.invoke !== 'function') return null;
  const key = sessionRequestPageKey(item, limit, offset);
  if(!key) return null;
  const cached = sessionRequestPageCache.get(key);
  if(cached && Date.now() - Number(cached.timestamp || 0) < 60000) return cached;
  if(sessionRequestPageInflight.has(key)) return sessionRequestPageInflight.get(key);
  const payload = normalizeSessionRequestPayload(item, limit, offset);
  const promise = ipcRenderer.invoke('dashboard:getSessionRequestsPage', payload)
    .then((page) => {
      if(page?.ok && Array.isArray(page.items)){
        const normalized = { ...page, timestamp: Date.now() };
        sessionRequestPageCache.set(key, normalized);
        return normalized;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => { try { sessionRequestPageInflight.delete(key); } catch {} });
  sessionRequestPageInflight.set(key, promise);
  return promise;
}
function prefetchSessionRequests(item, limit = 80){
  if(!item?.id) return;
  const key = sessionRequestPageKey(item, limit, 0);
  if(key && sessionRequestPageCache.has(key)) return;
  const run = () => loadSessionRequestsPage(item, limit, 0).catch(() => {});
  if(typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 300 });
  else setTimeout(run, 40);
}
async function ensureSessionRequests(item, limit = 80){
  const cached = cachedSessionRequests(item, limit);
  if(cached.length >= Math.min(limit, 6)) return cached.slice(0, limit);
  await loadSessionRequestsPage(item, limit, 0);
  return sessionRequests(item, limit);
}
function sessionRequests(item, limit = 50){
  if(!item) return [];
  const cached = cachedSessionRequests(item, limit);
  if(cached.length) return cached;
  if(!snapshot?.requestLog) return [];
  const out = [];
  const large = typeof isLargeRequestSnapshot === 'function' ? isLargeRequestSnapshot(snapshot) : (snapshot.requestLog || []).length > 5000;
  for(const r of snapshot.requestLog || []){
    if(r.sessionId !== item.id || sourceKey(r) !== sourceKey(item)) continue;
    out.push(r);
    if(large && out.length >= limit) break;
  }
  return out.sort((a, b) => (b.time || 0) - (a.time || 0));
}
function sessionSummaryText(item){ const u = item.usage || {}; const reqs = sessionRequests(item, 6).slice(0, 6).map((r) => `- ${dateLabel(r.time)} ${shortModel(r.model)} ${n(r.total)} token TTFT ${ms(r.ttftMs)}`).join('\n'); return [`${item.title || TXT.untitled}`, `ID: ${item.id || ''}`, `${TXT.source}: ${sourceName(item)}`, `${TXT.status}: ${item.archived ? TXT.archived : TXT.active}`, `${TXT.directory}: ${item.directory || ''}`, `${TXT.total}: ${n(u.total || 0)} token`, `${TXT.input}: ${n(u.input || 0)} / ${TXT.output}: ${n(u.output || 0)}`, `${TXT.cacheWrite}: ${n(u.cacheWrite || 0)} / ${TXT.cacheRead}: ${n(u.cacheRead || 0)} / ${TXT.cacheHitRate}: ${cacheHitText(u)}`, `${TXT.turns}: ${n(u.userTurns || 0)} / ${TXT.calls}: ${n(u.modelCalls || 0)}`, `${TXT.topModel}: ${sessionTopModel(item)}`, reqs ? `${TXT.requestDetails}:\n${reqs}` : `${TXT.requestDetails}: ${TXT.noRequests}`].join('\n'); }
function renderSessionEssentialInspector(item, selectedKey){
  const u = item.usage || {};
  const archived = Boolean(item.archived);
  const pinned = isPinnedSession(item);
  const meta = metaForSession(item);
  const tagValue = (meta.tags || []).join(', ');
  return `<aside class="session-inspector session-essential-inspector"><div class="inspector-head session-essential-head"><div><div class="inspector-title">${TXT.selectedSession}</div><h3>${esc(item.title || TXT.untitled)}</h3><p>${esc(item.id || '')}</p></div><div class="session-badges"><span class="session-state ${archived ? 'archived' : 'live'}">${archived ? TXT.archived : TXT.active}</span>${pinned ? `<span class="session-state pinned-state">${TXT.pinned}</span>` : ''}</div></div><div class="session-essential-summary session-essential-summary-lean"><div class="session-essential-meta"><div><span>${TXT.total}</span><b>${compact(u.total || 0)}</b></div><div><span>${TXT.updated}</span><b>${esc(dateLabel(item.updatedAt))}</b></div><div><span>${TXT.turns}</span><b>${n(u.userTurns || 0)}</b></div><div><span>${TXT.topModel}</span><b>${esc(sessionTopModel(item))}</b></div></div></div><div class="session-essential-actions inspector-actions"><button class="primary-action" data-session-action="open" data-session-key="${esc(selectedKey)}">${TXT.open}</button><button data-session-action="export-xlsx" data-session-key="${esc(selectedKey)}">${TXT.exportExcel}</button><button data-session-action="export-md" data-session-key="${esc(selectedKey)}">${TXT.exportMarkdownFile}</button><button data-session-action="export-json" data-session-key="${esc(selectedKey)}">${TXT.exportJsonFile}</button><button data-session-action="copy-summary" data-session-key="${esc(selectedKey)}">${TXT.copySummary}</button><button data-session-action="rename" data-session-key="${esc(selectedKey)}">${TXT.rename}</button><button data-session-pin="${esc(selectedKey)}">${pinned ? TXT.unpin : TXT.pin}</button><button class="dangerless" data-session-action="archive" data-session-key="${esc(selectedKey)}" data-archive="${archived ? 'false' : 'true'}">${archived ? TXT.restore : TXT.archive}</button></div><div class="inspector-block session-essential-save"><span>${TXT.notesTags} &#183; ${TXT.save}</span><div class="session-meta-editor"><div class="session-tags-preview">${sessionTagsHtml(item, 6)}</div><input data-session-tags="${esc(selectedKey)}" value="${esc(tagValue)}" placeholder="${TXT.tagsPlaceholder}" /><textarea data-session-note="${esc(selectedKey)}" placeholder="${TXT.notePlaceholder}">${esc(meta.note || '')}</textarea><small>${TXT.savedLocal}</small></div></div><div class="session-essential-foot"><span>${TXT.directory}</span><code title="${esc(item.directory || '')}">${esc(item.directory ? compactPath(item.directory) : emptyMetric())}</code></div></aside>`;
}
function renderSessionInspector(){
  const item = findSelectedSession();
  if(!item) return `<aside class="session-inspector empty"><div class="inspector-title">${TXT.selectedSession}</div><p>${TXT.noSessionSelected}</p></aside>`;
  selectedSessionId = sessionKeyFor(item);
  localStorage.setItem('selectedSessionId', selectedSessionId);
  prefetchSessionRequests(item, 80);
  return renderSessionEssentialInspector(item, selectedSessionId);
}
