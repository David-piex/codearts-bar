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
