function analyticsEmptyState(rows){
  if(rows.length) return '';
  return `<section class="dashboard-empty-state analytics-empty-state"><div><b>${TXT.emptyAnalyticsTitle}</b><span>${TXT.emptyAnalyticsHint}</span></div><button data-date-range-toggle="1">${TXT.dateRange}</button><button data-source="all">${TXT.allSource}</button></section>`;
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
