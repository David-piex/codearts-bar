function analyticsEmptyState(rows){
  const query = String(analyticsQuery || '').trim();
  const visibleRows = query && typeof applyTableSearch === 'function' ? applyTableSearch(rows) : rows;
  if(visibleRows.length) return '';
  const art = '<div class="empty-state-art" aria-hidden="true" style="display:grid;place-items:center;flex:0 0 48px;width:48px;height:48px;border-radius:8px;color:var(--mac-accent,#1687f5);background:var(--mac-accent-soft,#eef4ff)"><svg viewBox="0 0 32 32" width="30" height="30" fill="none"><rect x="5.5" y="5.5" width="21" height="21" rx="4.5" stroke="currentColor"/><path d="M10 21v-4m6 4V11m6 10v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 25h14" stroke="currentColor" stroke-linecap="round" opacity=".45"/></svg></div>';
  const copy = query ? `<div><b>${TXT.emptyHint}</b><span>${TXT.searchKeyword}: ${esc(query)}</span></div><button data-analytics-query-clear="1">${TXT.resetFilters}</button>` : `<div><b>${TXT.emptyAnalyticsTitle}</b><span>${TXT.emptyAnalyticsHint}</span></div><button data-date-range-toggle="1">${TXT.dateRange}</button><button data-source="all">${TXT.allSource}</button>`;
  return `<section class="dashboard-empty-state analytics-empty-state">${art}${copy}</section>`;
}
function rememberSlotHtml(id, html){
  try { if(slotHtmlCache) slotHtmlCache.set(id, html); } catch {}
}
function patchHtmlSlot(id, html){
  const el = document.getElementById(id);
  if(!el) return false;
  const next = String(html ?? '');
  try { if(slotHtmlCache?.get(id) === next) return true; } catch {}
  rememberSlotHtml(id, next);
  try { lastCommittedHtml = ''; } catch {}
  el.innerHTML = next;
  return true;
}
function analyticsSlotsReady(){
  if(typeof document.querySelector !== 'function') return false;
  return Boolean(document.querySelector('#analyticsSummarySlot') && document.querySelector('#analyticsChartSlot') && document.querySelector('#analyticsTableSlot'));
}
