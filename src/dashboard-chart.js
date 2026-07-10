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
  const hasPayload = Object.keys(payload || {}).length > 0;
  const range = payload.range || {};
  const currentRange = currentPageRangePayload();
  const expectedOffset = typeof currentRequestPageOffset === 'function' ? currentRequestPageOffset() : Math.max(0, Number(requestTablePage || 0)) * REQUEST_PAGE_SIZE;
  const expectedLimit = REQUEST_PAGE_SIZE;
  if(!hasPayload) return Number(requestTablePage || 0) === 0;
  return String(payload.source || 'all') === String(sourceFilter || 'all')
    && String(payload.model || 'all') === String(modelFilter || 'all')
    && String(payload.query || '') === String(analyticsQuery || '')
    && Number(payload.offset || 0) === Number(expectedOffset || 0)
    && Number(payload.limit || expectedLimit) === Number(expectedLimit)
    && Number(range.start || 0) === Number(currentRange.start || 0)
    && Number(range.end || 0) === Number(currentRange.end || 0);
}
function requestTableData(rows, s){
  const limit = REQUEST_PAGE_SIZE;
  const dbPage = typeof requestPageRowsForCurrentView === 'function' ? requestPageRowsForCurrentView(s) : null;
  if(dbPage?.paged){
    const items = dbPage.list || [];
    return { list: items.slice(0, limit), total: Number(dbPage.total || items.length), limit, page: requestTablePage, paged: true };
  }
  const matched = applyTableSearch(rows);
  const totalHint = Number(s?.requestTotal || 0);
  const total = Math.max(matched.length, totalHint || 0);
  const start = Math.max(0, Number(requestTablePage || 0)) * limit;
  const canServeFromMemory = start < matched.length || !totalHint || totalHint <= matched.length;
  if(!canServeFromMemory){
    return { list: [], total, limit, page: requestTablePage, loading: true };
  }
  return { list: matched.slice(start, start + limit), total, limit, page: requestTablePage };
}
function tablePaginationHtml(kind, rendered, total, page, pageSize, loading = false){
  const safeTotal = Math.max(0, Number(total || 0));
  if(safeTotal <= 0) return '';
  const safeRendered = Math.max(0, Number(rendered || 0));
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const safePage = Math.max(0, Math.min(totalPages - 1, Number(page || 0)));
  const start = safeTotal ? safePage * pageSize + (safeRendered ? 1 : 0) : 0;
  const end = Math.min(safeTotal, safePage * pageSize + safeRendered);
  const isSessions = kind === 'sessions';
  const prefix = isSessions ? 'session' : 'request';
  const label = isSessions ? (TXT.sessionPagination || '\u4f1a\u8bdd\u5206\u9875') : (TXT.requestPagination || '\u8bf7\u6c42\u5206\u9875');
  const sizeOptions = TABLE_PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}" ${Number(pageSize) === size ? 'selected' : ''}>${size}</option>`).join('');
  const feedback = pagedTableFeedback?.[kind] || '';
  return `<div class="table-limit-note table-page-note ${prefix}-page-note ${feedback ? 'is-page-adjusted' : ''}" data-table-limit="${kind}" data-rendered="${safeRendered}" data-total="${safeTotal}" data-page="${safePage}" data-page-size="${pageSize}" ${feedback ? `data-page-feedback="${esc(feedback)}"` : ''}><span>${label}\uff1a${n(start)}-${n(end)} / ${n(safeTotal)} \u00b7 ${TXT.page || '\u7b2c'} ${n(safePage + 1)} / ${n(totalPages)}${loading ? ' \u00b7 \u52a0\u8f7d\u4e2d...' : ''}${feedback ? ` \u00b7 ${esc(feedback)}` : ''}</span><div class="table-page-actions"><label class="table-page-field table-page-size"><span>\u6bcf\u9875</span><select data-${prefix}-page-size aria-label="\u6bcf\u9875\u884c\u6570">${sizeOptions}</select><span>\u884c</span></label><button data-${prefix}-page="prev" ${safePage <= 0 ? 'disabled' : ''}>${TXT.prevPage || '\u4e0a\u4e00\u9875'}</button><label class="table-page-field table-page-jump"><span>\u8df3\u81f3</span><input data-${prefix}-page-input value="${safePage + 1}" inputmode="numeric" pattern="[0-9]*" aria-label="\u9875\u7801" ${feedback ? `class="is-page-adjusted" aria-invalid="true" title="${esc(feedback)}"` : 'aria-invalid="false"'} /><span>\u9875</span></label><button data-${prefix}-page-go>\u8df3\u8f6c</button><button data-${prefix}-page="next" ${safePage >= totalPages - 1 ? 'disabled' : ''}>${TXT.nextPage || '\u4e0b\u4e00\u9875'}</button></div></div>`;
}
function tableRows(rows, s){
  const tableStartedAt = perfNow();
  const data = requestTableData(rows, s);
  const list = data.list;
  const body = data.loading ? `<tr><td colspan="15" class="empty-cell table-loading-cell">正在加载第 ${n(Number(requestTablePage || 0) + 1)} 页...</td></tr>` : (list.length ? list.map(requestRowHtml).join('') : emptyRow(15));
  const pager = tablePaginationHtml('requests', list.length, data.total, requestTablePage, REQUEST_PAGE_SIZE, data.loading);
  const html = `<div class="request-manager request-manager-flat"><div class="request-main request-main-full"><div class="table-scroll"><table><thead><tr><th>${TXT.time}</th><th>${TXT.source}</th><th>${TXT.provider}</th><th>${TXT.model}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.speed}</th><th>${TXT.status}</th><th>${TXT.session}</th></tr></thead><tbody>${body}</tbody></table></div>${pager}</div></div>`;
  markPerfStage('tableRenderMs', perfNow() - tableStartedAt);
  return html;
}

function statTable(groups, label){ const list = groups.slice(0, 160); return `<div class="table-scroll"><table><thead><tr><th>${label}</th><th>${TXT.requests}</th><th>${TXT.input}</th><th>${TXT.output}</th><th>${TXT.cacheWrite}</th><th>${TXT.cacheRead}</th><th>${TXT.cacheHitRate}</th><th>${TXT.total}</th><th>${TXT.ttft}</th><th>${TXT.wait}</th><th>${TXT.status}</th></tr></thead><tbody>${list.length ? list.map((g) => `<tr><td><b>${esc(label === TXT.model ? shortModel(g.key) : g.key)}</b></td><td>${n(g.stats.requests)}</td><td>${n(g.stats.input)}</td><td>${n(g.stats.output)}</td><td>${n(g.stats.cacheWrite)}</td><td>${n(g.stats.cacheRead)}</td><td class="cache-cell">${cachePillHtml(g.stats)}</td><td><b>${n(g.stats.total)}</b></td><td>${ms(avg(g.stats.ttfts))}</td><td>${ms(avg(g.stats.latencies))}</td><td class="${g.stats.errors ? 'bad' : 'ok'}">${g.stats.errors ? `${n(g.stats.errors)} ${TXT.errorCount}` : '200'}</td></tr>`).join('') : emptyRow(11)}</tbody></table></div>`; }
