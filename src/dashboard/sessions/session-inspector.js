function sessionTopModel(session){ const model = session?.usage?.topModel; if(!model) return emptyMetric(); return shortModel(model.model || model.key || TXT.unknown); }
function findSelectedSession(){ return sessionTableItems.find((x) => sessionKeyFor(x) === selectedSessionId) || sessionTableItems[0] || null; }
function saveSelectedSessions(){ localStorage.setItem('selectedSessionKeys', [...selectedSessionKeys].join('|')); }
function savePinnedSessions(){ localStorage.setItem('pinnedSessionKeys', [...pinnedSessionKeys].join('|')); }
function sessionByKey(key){ return (snapshot?.sessions || []).find((x) => sessionKeyFor(x) === key) || sessionTableItems.find((x) => sessionKeyFor(x) === key) || null; }
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
  return out;
}
function isPinnedSession(item){ return pinnedSessionKeys.has(sessionKeyFor(item)); }
function compactPath(value){ const text = String(value || ''); if(text.length <= 42) return text; return `...${text.slice(-39)}`; }
function sessionRequests(item, limit = 50){
  if(!item || !snapshot?.requestLog) return [];
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
function sessionMarkdown(item){
  const u = item.usage || {};
  const models = (u.models || []).map((m) => `| ${shortModel(m.model || m.key || 'unknown')} | ${m.provider || ''} | ${n(m.calls || 0)} | ${n(m.total || 0)} | ${n(m.input || 0)} | ${n(m.output || 0)} |`).join('\n') || `| ${TXT.noData} |  | 0 | 0 | 0 | 0 |`;
  const reqs = sessionRequests(item, 80).map((r) => `| ${dateLabel(r.time)} | ${shortModel(r.model)} | ${n(r.total)} | ${ms(r.ttftMs)} | ${ms(r.latencyMs)} | ${rate(r.outputTokensPerSec)} | ${r.ok ? '200' : r.status} |`).join('\n') || `| ${TXT.noData} | ${TXT.noData} | 0 | ${TXT.noData} | ${TXT.noData} | ${TXT.noData} | ${TXT.noData} |`;
  return [
    `# ${item.title || TXT.untitled}`,
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
function renderSessionEssentialInspector(item, selectedKey){
  const u = item.usage || {};
  const archived = Boolean(item.archived);
  const pinned = isPinnedSession(item);
  const meta = metaForSession(item);
  const tagValue = (meta.tags || []).join(', ');
  return `<aside class="session-inspector session-essential-inspector"><div class="inspector-head session-essential-head"><div><div class="inspector-title">${TXT.selectedSession}</div><h3>${esc(item.title || TXT.untitled)}</h3><p>${esc(item.id || '')}</p></div><div class="session-badges"><span class="session-state ${archived ? 'archived' : 'live'}">${archived ? TXT.archived : TXT.active}</span>${pinned ? `<span class="session-state pinned-state">${TXT.pinned}</span>` : ''}</div></div><div class="session-essential-summary session-essential-summary-lean"><div class="session-essential-meta"><div><span>${TXT.total}</span><b>${compact(u.total || 0)}</b></div><div><span>${TXT.updated}</span><b>${esc(dateLabel(item.updatedAt))}</b></div><div><span>${TXT.turns}</span><b>${n(u.userTurns || 0)}</b></div><div><span>${TXT.topModel}</span><b>${esc(sessionTopModel(item))}</b></div></div></div><div class="session-essential-actions inspector-actions"><button class="primary-action" data-session-action="open" data-session-key="${esc(selectedKey)}">${TXT.open}</button><button data-session-action="copy-summary" data-session-key="${esc(selectedKey)}">${TXT.copySummary}</button><button data-session-action="rename" data-session-key="${esc(selectedKey)}">${TXT.rename}</button><button data-session-pin="${esc(selectedKey)}">${pinned ? TXT.unpin : TXT.pin}</button><button class="dangerless" data-session-action="archive" data-session-key="${esc(selectedKey)}" data-archive="${archived ? 'false' : 'true'}">${archived ? TXT.restore : TXT.archive}</button></div><div class="inspector-block session-essential-save"><span>${TXT.notesTags} &#183; ${TXT.save}</span><div class="session-meta-editor"><div class="session-tags-preview">${sessionTagsHtml(item, 6)}</div><input data-session-tags="${esc(selectedKey)}" value="${esc(tagValue)}" placeholder="${TXT.tagsPlaceholder}" /><textarea data-session-note="${esc(selectedKey)}" placeholder="${TXT.notePlaceholder}">${esc(meta.note || '')}</textarea><small>${TXT.savedLocal}</small></div></div><div class="session-essential-foot"><span>${TXT.directory}</span><code title="${esc(item.directory || '')}">${esc(item.directory ? compactPath(item.directory) : emptyMetric())}</code><button data-session-advanced-toggle="1">${TXT.showAdvanced}</button></div></aside>`;
}
function renderSessionInspector(){
  const item = findSelectedSession();
  if(!item) return `<aside class="session-inspector empty"><div class="inspector-title">${TXT.selectedSession}</div><p>${TXT.noSessionSelected}</p></aside>`;
  selectedSessionId = sessionKeyFor(item);
  localStorage.setItem('selectedSessionId', selectedSessionId);
  return renderSessionEssentialInspector(item, selectedSessionId);
}
