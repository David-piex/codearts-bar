function emptyRow(colspan){ return `<tr><td colspan="${colspan}" class="empty-cell">${TXT.emptyHint}</td></tr>`; }
function requestKeyFor(r){ return `${sourceKey(r)}:${r.id || ''}:${r.sessionId || ''}:${r.time || ''}`; }
function requestByKey(key){ return (snapshot?.requestLog || []).find((r) => requestKeyFor(r) === key) || null; }
function selectedRequestFrom(list){ if(selectedRequestKey && list.some((r) => requestKeyFor(r) === selectedRequestKey)) return list.find((r) => requestKeyFor(r) === selectedRequestKey); const first = list[0] || null; selectedRequestKey = first ? requestKeyFor(first) : ''; localStorage.setItem('selectedRequestKey', selectedRequestKey); return first; }
function renderRequestInspector(list){
  const r = selectedRequestFrom(list);
  if(!r) return `<aside class="request-inspector empty"><div class="inspector-title">${TXT.requestInspector}</div><p>${TXT.emptyHint}</p></aside>`;
  const key = requestKeyFor(r);
  return `<aside class="request-inspector"><div class="inspector-head"><div><div class="inspector-title">${TXT.requestInspector}</div><h3>${esc(shortModel(r.model))}</h3><p>${esc(r.sessionTitle || r.sessionId || '')}</p></div><span class="session-state ${r.ok ? 'live' : 'archived'}">${esc(r.status)}</span></div><div class="inspector-grid">${sessionStat(TXT.total, compact(r.total || 0))}${sessionStat(TXT.input, compact(r.input || 0))}${sessionStat(TXT.output, compact(r.output || 0))}${sessionStat(TXT.cacheWrite, compact(r.cacheWrite || 0))}${sessionStat(TXT.cacheRead, compact(r.cacheRead || 0))}${sessionStat(TXT.cacheHitRate, cacheHitText(r))}${sessionStat(TXT.ttft, ms(r.ttftMs))}${sessionStat(TXT.firstContent, ms(r.firstContentMs))}${sessionStat(TXT.wait, ms(r.latencyMs))}${sessionStat(TXT.speed, rate(r.outputTokensPerSec))}${sessionStat(TXT.source, sourceName(r))}</div><div class="inspector-block"><span>${TXT.provider} / ${TXT.model}</span><code>${esc(r.provider || 'unknown')} / ${esc(r.model || 'unknown')}</code></div><div class="inspector-block cache-inspector-block"><span>${TXT.cacheEfficiency}</span>${cacheEfficiencyPanel(r, 'inspector-cache')}</div><div class="inspector-block"><span>${TXT.tokenInputOutput}</span><div class="token-stack"><i style="--w:${Math.max(2, Math.min(100, ((r.input || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.input}"></i><i style="--w:${Math.max(2, Math.min(100, ((r.output || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.output}"></i><i style="--w:${Math.max(2, Math.min(100, ((r.cacheWrite || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.cacheWrite}"></i><i style="--w:${Math.max(2, Math.min(100, ((r.cacheRead || 0) / Math.max(1, r.total || 1)) * 100))}%; --c:${COLORS.cacheRead}"></i></div></div><div class="inspector-block"><span>${TXT.session}</span><code>${esc(r.sessionId || 'N/A')}</code></div>${r.error ? `<div class="inspector-block"><span>Error</span><code>${esc(r.error)}</code></div>` : ''}<div class="inspector-actions"><button class="primary-action" data-request-action="view-session" data-request-key="${esc(key)}">${TXT.viewSession}</button><button data-request-action="copy-json" data-request-key="${esc(key)}">${TXT.copyRequestJson}</button><button data-request-action="copy-session" data-request-key="${esc(key)}">${TXT.copyId}</button></div></aside>`;
}

function requestRowHtml(r){
  const key = requestKeyFor(r);
  const selected = key === selectedRequestKey;
  return `<tr class="request-row ${selected ? 'selected' : ''}" data-request-select="${esc(key)}"><td>${esc(dateLabel(r.time))}</td><td><span class="source-pill">${esc(sourceName(r))}</span></td><td>${esc(r.provider)}</td><td><code>${esc(shortModel(r.model))}</code></td><td>${n(r.input)}</td><td>${n(r.output)}</td><td>${n(r.cacheWrite || 0)}</td><td>${n(r.cacheRead || 0)}</td><td class="cache-cell">${cachePillHtml(r)}</td><td><b>${n(r.total)}</b></td><td>${ms(r.ttftMs)}</td><td>${ms(r.latencyMs)}</td><td>${rate(r.outputTokensPerSec)}</td><td class="${r.ok ? 'ok' : 'bad'}">${esc(r.status)}</td><td><div>${esc(r.sessionTitle)}</div><div class="muted">${esc(r.sessionId)}</div></td></tr>`;
}
function requestLimitNote(rendered, total){
  return rendered < total ? `<div class="table-limit-note" data-table-limit="requests" data-rendered="${rendered}" data-total="${total}">\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} \u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22\u7f29\u5c0f\u8303\u56f4\u3002</div>` : '';
}
function tableRows(rows){
  const tableStartedAt = perfNow();
  const matched = applyTableSearch(rows);
  const limit = Math.max(100, Number(requestTableRenderLimit || 100));
  const list = matched.slice(0, limit);
  selectedRequestFrom(list);
  const body = list.length ? list.map(requestRowHtml).join('') : emptyRow(15);
  const clipped = requestLimitNote(list.length, matched.length);
  const html = `<div class="request-manager"><div class="request-main"><div class="table-scroll"><table><thead><tr><th>${TXT.time}</th><th>${TXT.source}</th><th>${TXT.provider}</th><th>${TXT.model}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.speed}</th><th>${TXT.status}</th><th>${TXT.session}</th></tr></thead><tbody>${body}</tbody></table></div>${clipped}</div>${renderRequestInspector(list)}</div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
}

function statTable(groups, label){ const list = groups.slice(0, 160); return `<div class="table-scroll"><table><thead><tr><th>${label}</th><th>${TXT.requests}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.status}</th></tr></thead><tbody>${list.length ? list.map((g) => `<tr><td><b>${esc(label === TXT.model ? shortModel(g.key) : g.key)}</b></td><td>${n(g.stats.requests)}</td><td>${n(g.stats.input)}</td><td>${n(g.stats.output)}</td><td>${n(g.stats.cacheWrite)}</td><td>${n(g.stats.cacheRead)}</td><td class="cache-cell">${cachePillHtml(g.stats)}</td><td><b>${n(g.stats.total)}</b></td><td>${ms(avg(g.stats.ttfts))}</td><td>${ms(avg(g.stats.latencies))}</td><td class="${g.stats.errors ? 'bad' : 'ok'}">${g.stats.errors ? `${n(g.stats.errors)} error` : '200'}</td></tr>`).join('') : emptyRow(11)}</tbody></table></div>`; }
