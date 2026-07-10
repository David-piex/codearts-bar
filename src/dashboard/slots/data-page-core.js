// Shared pagination slot helpers for request/session tables.
// Loaded before request-page-slot.js and session-page-slot.js.

function updateLimitNote(kind, rendered, total){
  const note = document.querySelector(`[data-table-limit="${kind}"]`);
  if(!note) return;
  note.dataset.rendered = String(rendered);
  note.dataset.total = String(total);
  if(note.classList?.contains?.('table-page-note')){
    const isSessions = kind === 'sessions';
    const pageSize = isSessions ? SESSION_PAGE_SIZE : REQUEST_PAGE_SIZE;
    const current = isSessions ? sessionTablePage : requestTablePage;
    const totalPages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
    const page = Math.max(0, Math.min(totalPages - 1, Number(current || 0)));
    const displayCount = Number(rendered || 0) || Math.min(pageSize, Math.max(0, Number(total || 0) - page * pageSize));
    const start = page * pageSize + (displayCount ? 1 : 0);
    const end = Math.min(Number(total || 0), page * pageSize + displayCount);
    const span = note.querySelector('span');
    const label = isSessions ? (TXT.sessionPagination || '会话分页') : (TXT.requestPagination || '请求分页');
    const feedback = pagedTableFeedback?.[kind] || '';
    note.classList?.toggle?.('is-page-adjusted', Boolean(feedback));
    if(feedback) note.setAttribute('data-page-feedback', feedback);
    else note.removeAttribute('data-page-feedback');
    if(span) span.textContent = `${label}：${n(start)}-${n(end)} / ${n(total)} · ${TXT.page || '第'} ${n(page + 1)} / ${n(totalPages)}${feedback ? ` · ${feedback}` : ''}`;
    const prefix = isSessions ? 'session' : 'request';
    const input = note.querySelector(`[data-${prefix}-page-input]`);
    if(input && document.activeElement !== input) input.value = String(page + 1);
    const size = note.querySelector(`[data-${prefix}-page-size]`);
    if(size && Number(size.value) !== Number(pageSize)) size.value = String(pageSize);
    const prev = note.querySelector(`[data-${prefix}-page="prev"]`);
    const next = note.querySelector(`[data-${prefix}-page="next"]`);
    if(prev) prev.disabled = page <= 0;
    if(next) next.disabled = page >= totalPages - 1;
    return;
  }
  if(rendered >= total){ note.remove?.(); return; }
  const suffix = kind === 'sessions'
    ? '\u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22 / \u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002'
    : '\u884c\uff0c\u6eda\u52a8\u5230\u5e95\u90e8\u7ee7\u7eed\u52a0\u8f7d\uff0c\u6216\u7ee7\u7eed\u641c\u7d22\u7f29\u5c0f\u8303\u56f4\u3002';
  note.textContent = `\u5df2\u5148\u6e32\u67d3 ${n(rendered)} / ${n(total)} ${suffix}`;
}
function pageInputState(value, total, pageSize, fallback = 0){
  const maxPage = maxTablePageIndex(total, pageSize);
  const fallbackPage = Math.max(0, Math.min(maxPage, Number(fallback || 0)));
  const raw = String(value ?? '').trim();
  if(!raw) return { page: fallbackPage, adjusted: false, reason: '' };
  if(/^-+\d+$/.test(raw)) return { page: 0, adjusted: true, reason: '已回到第 1 页' };
  if(!/^\d+$/.test(raw)) return { page: fallbackPage, adjusted: true, reason: '页码已恢复' };
  const nValue = Number(raw);
  if(!Number.isSafeInteger(nValue)) return { page: fallbackPage, adjusted: true, reason: '页码已恢复' };
  if(nValue < 1) return { page: 0, adjusted: true, reason: '已回到第 1 页' };
  if(nValue > maxPage + 1) return { page: maxPage, adjusted: true, reason: `已修正到第 ${n(maxPage + 1)} 页` };
  return { page: nValue - 1, adjusted: false, reason: '' };
}
function setPagedTableFeedback(kind, text = '', timeout = 1400){
  try {
    pagedTableFeedback = { ...(pagedTableFeedback || {}), [kind]: String(text || '') };
    const note = document.querySelector(`[data-table-limit="${kind}"]`);
    if(note){
      note.classList?.toggle?.('is-page-adjusted', Boolean(text));
      if(text) note.setAttribute('data-page-feedback', String(text));
      else note.removeAttribute('data-page-feedback');
      const prefix = kind === 'sessions' ? 'session' : 'request';
      const input = note.querySelector(`[data-${prefix}-page-input]`);
      if(input){
        input.setAttribute('aria-invalid', text ? 'true' : 'false');
        input.classList?.toggle?.('is-page-adjusted', Boolean(text));
        if(text) input.title = String(text);
        else input.removeAttribute('title');
      }
    }
    if(!pagedTableFeedbackTimers) pagedTableFeedbackTimers = { requests: null, sessions: null };
    if(pagedTableFeedbackTimers[kind]) clearTimeout(pagedTableFeedbackTimers[kind]);
    pagedTableFeedbackTimers[kind] = null;
    if(text && timeout > 0){
      pagedTableFeedbackTimers[kind] = setTimeout(() => {
        pagedTableFeedbackTimers[kind] = null;
        pagedTableFeedback = { ...(pagedTableFeedback || {}), [kind]: '' };
        updateLimitNote(kind, Number(document.querySelector(`[data-table-limit="${kind}"]`)?.dataset?.rendered || 0), kind === 'sessions' ? sessionPageTotalHint() : requestPageTotalHint());
      }, timeout);
    }
  } catch {}
}
function scrollPagedTableToTop(kind){
  try {
    const scroller = kind === 'sessions'
      ? document.querySelector('.session-scroll')
      : document.querySelector('.request-main .table-scroll');
    if(scroller) scroller.scrollTop = 0;
  } catch {}
}
function syncPagedTableInput(kind, total, page, pageSize){
  try {
    const prefix = kind === 'sessions' ? 'session' : 'request';
    const safePage = clampTablePageIndex(page, total, pageSize);
    const feedback = pagedTableFeedback?.[kind] || '';
    const input = document.querySelector(`[data-${prefix}-page-input]`);
    if(input){
      input.value = String(safePage + 1);
      input.setAttribute('aria-invalid', feedback ? 'true' : 'false');
      input.classList?.toggle?.('is-page-adjusted', Boolean(feedback));
      if(feedback) input.title = feedback;
      else input.removeAttribute('title');
    }
    const note = document.querySelector(`[data-table-limit="${kind}"]`);
    if(note){
      note.dataset.page = String(safePage);
      note.dataset.pageSize = String(pageSize);
      note.classList?.toggle?.('is-page-adjusted', Boolean(feedback));
      if(feedback) note.setAttribute('data-page-feedback', feedback);
      else note.removeAttribute('data-page-feedback');
    }
    return safePage;
  } catch {
    return clampTablePageIndex(page, total, pageSize);
  }
}
function setPagedTableLoading(kind, active = true, page = 0){
  try {
    const isSessions = kind === 'sessions';
    const prefix = isSessions ? 'session' : 'request';
    const pageSize = isSessions ? SESSION_PAGE_SIZE : REQUEST_PAGE_SIZE;
    const total = isSessions ? sessionPageTotalHint() : requestPageTotalHint();
    const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(total || 0)) / pageSize));
    const safePage = syncPagedTableInput(kind, total, page, pageSize);
    const note = document.querySelector(`[data-table-limit="${kind}"]`);
    const scroller = isSessions ? document.querySelector('.session-scroll') : document.querySelector('.request-main .table-scroll');
    const buttons = note?.querySelectorAll?.('button, select, input') || [];
    note?.classList?.toggle?.('is-page-loading', Boolean(active));
    scroller?.classList?.toggle?.('is-page-loading', Boolean(active));
    scroller?.setAttribute?.('aria-busy', active ? 'true' : 'false');
    buttons.forEach((node) => {
      if(node.matches?.(`[data-${prefix}-page-input]`)) return;
      node.disabled = Boolean(active);
    });
    const span = note?.querySelector?.('span');
    if(span && active){
      const loading = TXT.loading || '正在加载';
      const pageLabel = TXT.page || '第';
      span.textContent = `${loading} ${pageLabel} ${n(safePage + 1)} / ${n(totalPages)}`;
    }
    if(!active) updateLimitNote(kind, Number(note?.dataset?.rendered || 0), Number(total || 0));
    return true;
  } catch {
    return false;
  }
}
function clearPagedTableLoading(kind){
  try {
    const isSessions = kind === 'sessions';
    const prefix = isSessions ? 'session' : 'request';
    const pageSize = isSessions ? SESSION_PAGE_SIZE : REQUEST_PAGE_SIZE;
    const total = isSessions ? sessionPageTotalHint() : requestPageTotalHint();
    const page = isSessions ? sessionTablePage : requestTablePage;
    const note = document.querySelector(`[data-table-limit="${kind}"]`);
    const scroller = isSessions ? document.querySelector('.session-scroll') : document.querySelector('.request-main .table-scroll');
    note?.classList?.remove?.('is-page-loading');
    scroller?.classList?.remove?.('is-page-loading');
    scroller?.setAttribute?.('aria-busy', 'false');
    note?.querySelectorAll?.('button, select, input')?.forEach?.((node) => {
      if(node.matches?.(`[data-${prefix}-page="prev"]`)) node.disabled = clampTablePageIndex(page, total, pageSize) <= 0;
      else if(node.matches?.(`[data-${prefix}-page="next"]`)) node.disabled = clampTablePageIndex(page, total, pageSize) >= maxTablePageIndex(total, pageSize);
      else node.disabled = false;
    });
    return true;
  } catch {
    return false;
  }
}
function replaceTablePagination(kind, html, container){
  if(!container) return false;
  const current = container.querySelector(`[data-table-limit="${kind}"]`);
  if(!html){
    current?.remove?.();
    return true;
  }
  if(current){
    current.outerHTML = html;
    return true;
  }
  const scroller = kind === 'sessions' ? container.querySelector('.session-scroll') : container.querySelector('.table-scroll');
  if(scroller && typeof scroller.insertAdjacentHTML === 'function'){
    scroller.insertAdjacentHTML('afterend', html);
    return true;
  }
  return false;
}
function requestPageTotalHint(){
  return Number(document.querySelector('[data-table-limit="requests"]')?.dataset?.total || requestPageCache?.total || snapshot?.requestTotal || snapshot?.requestPage?.total || (snapshot?.requestLog || []).length || 0);
}
function sessionPageTotalHint(){
  return Number(document.querySelector('[data-table-limit="sessions"]')?.dataset?.total || sessionPageCache?.total || snapshot?.sessionTotal || snapshot?.sessionPage?.total || (snapshot?.sessions || []).length || 0);
}
function currentPageRangePayload(){
  if(!snapshot?.ok) return {};
  return { start: sinceForRange(snapshot), end: untilForRange(snapshot) };
}
function sameRangePayload(a = {}, b = {}){
  const ar = a.range || {};
  const br = b.range || {};
  return Number(ar.start || 0) === Number(br.start || 0) && Number(ar.end || 0) === Number(br.end || 0);
}
