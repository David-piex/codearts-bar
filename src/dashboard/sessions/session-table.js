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
  const html = `<div class="session-manager"><div id="sessionTableSlot" class="session-main">${rows}</div><div id="sessionInspectorSlot">${renderSessionInspector()}</div></div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
}
