function emptyRow(colspan){ return `<tr><td colspan="${colspan}" class="empty-cell">${TXT.emptyHint}</td></tr>`; }
function requestKeyFor(r){ return `${sourceKey(r)}:${r.id || ''}:${r.sessionId || ''}:${r.time || ''}`; }
function requestByKey(key){ return (snapshot?.requestLog || []).find((r) => requestKeyFor(r) === key) || null; }
function selectedRequestFrom(list){ if(selectedRequestKey && list.some((r) => requestKeyFor(r) === selectedRequestKey)) return list.find((r) => requestKeyFor(r) === selectedRequestKey); const first = list[0] || null; selectedRequestKey = first ? requestKeyFor(first) : ''; localStorage.setItem('selectedRequestKey', selectedRequestKey); return first; }
function requestRowHtml(r){
  const key = requestKeyFor(r);
  const selected = key === selectedRequestKey;
  return `<tr class="request-row ${selected ? 'selected' : ''}" data-request-select="${esc(key)}"><td>${esc(dateLabel(r.time))}</td><td><span class="source-pill">${esc(sourceName(r))}</span></td><td>${esc(r.provider)}</td><td><code>${esc(shortModel(r.model))}</code></td><td>${n(r.input)}</td><td>${n(r.output)}</td><td>${n(r.cacheWrite || 0)}</td><td>${n(r.cacheRead || 0)}</td><td class="cache-cell">${cachePillHtml(r)}</td><td><b>${n(r.total)}</b></td><td>${ms(r.ttftMs)}</td><td>${ms(r.latencyMs)}</td><td>${rate(r.outputTokensPerSec)}</td><td class="${r.ok ? 'ok' : 'bad'}">${esc(r.status)}</td><td><div>${esc(r.sessionTitle)}</div><div class="muted">${esc(r.sessionId)}</div></td></tr>`;
}
function requestLimitNote(rendered, total){
  return rendered < total ? `<div class="table-limit-note" data-table-limit="requests" data-rendered="${rendered}" data-total="${total}">\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} \u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22\u7f29\u5c0f\u8303\u56f4\u3002</div>` : '';
}
function requestPageMatchesTable(s){
  const page = s?.requestPage;
  if(!page || !Array.isArray(page.items)) return false;
  const payload = page.payload || {};
  const range = payload.range || {};
  const currentRange = currentPageRangePayload();
  return String(payload.source || 'all') === String(sourceFilter || 'all')
    && String(payload.model || 'all') === String(modelFilter || 'all')
    && String(payload.query || '') === String(analyticsQuery || '')
    && Number(range.start || 0) === Number(currentRange.start || 0)
    && Number(range.end || 0) === Number(currentRange.end || 0);
}
function requestTableData(rows, s){
  const limit = Math.max(100, Number(requestTableRenderLimit || 100));
  if(requestPageMatchesTable(s)){
    const items = s.requestPage.items || [];
    return { list: items.slice(0, limit), total: Number(s.requestPage.total || items.length), limit };
  }
  const matched = applyTableSearch(rows);
  return { list: matched.slice(0, limit), total: matched.length, limit };
}
function tableRows(rows, s){
  const tableStartedAt = perfNow();
  const data = requestTableData(rows, s);
  const list = data.list;
  const body = list.length ? list.map(requestRowHtml).join('') : emptyRow(15);
  const clipped = requestLimitNote(list.length, data.total);
  const html = `<div class="request-manager request-manager-flat"><div class="request-main request-main-full"><div class="table-scroll"><table><thead><tr><th>${TXT.time}</th><th>${TXT.source}</th><th>${TXT.provider}</th><th>${TXT.model}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.speed}</th><th>${TXT.status}</th><th>${TXT.session}</th></tr></thead><tbody>${body}</tbody></table></div>${clipped}</div></div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
}

function statTable(groups, label){ const list = groups.slice(0, 160); return `<div class="table-scroll"><table><thead><tr><th>${label}</th><th>${TXT.requests}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.status}</th></tr></thead><tbody>${list.length ? list.map((g) => `<tr><td><b>${esc(label === TXT.model ? shortModel(g.key) : g.key)}</b></td><td>${n(g.stats.requests)}</td><td>${n(g.stats.input)}</td><td>${n(g.stats.output)}</td><td>${n(g.stats.cacheWrite)}</td><td>${n(g.stats.cacheRead)}</td><td class="cache-cell">${cachePillHtml(g.stats)}</td><td><b>${n(g.stats.total)}</b></td><td>${ms(avg(g.stats.ttfts))}</td><td>${ms(avg(g.stats.latencies))}</td><td class="${g.stats.errors ? 'bad' : 'ok'}">${g.stats.errors ? `${n(g.stats.errors)} ${TXT.errorCount}` : '200'}</td></tr>`).join('') : emptyRow(11)}</tbody></table></div>`; }
