function analyticsEmptyState(rows){
  if(rows.length) return '';
  return `<section class="dashboard-empty-state analytics-empty-state"><div><b>${TXT.emptyAnalyticsTitle}</b><span>${TXT.emptyAnalyticsHint}</span></div><button data-date-range-toggle="1">${TXT.dateRange}</button><button data-source="all">${TXT.allSource}</button></section>`;
}
function patchHtmlSlot(id, html){
  const el = document.getElementById(id);
  if(!el) return false;
  if(el.innerHTML !== html) el.innerHTML = html;
  return true;
}
function analyticsSlotsReady(){
  if(typeof document.querySelector !== 'function') return false;
  return Boolean(document.querySelector('#analyticsSummarySlot') && document.querySelector('#analyticsChartSlot') && document.querySelector('#analyticsTableSlot'));
}
function analyticsTableHtml(rows, s){ const t = perfNow(); const html = renderTable(rows, s); markPerfStage('lowerRenderMs', perfNow() - t); return html; }
function analyticsAdvancedHtml(rows, s){ const t = perfNow(); const html = renderAnalyticsAdvanced(rows, s); markPerfStage('lowerRenderMs', perfNow() - t); return html; }
function analyticsShellHtml(s, rows, opts = {}){
  const deferHeavy = opts.deferHeavy === true;
  const tableHtml = deferHeavy ? '<div id="analyticsDeferred" class="analytics-deferred"><span>\u6b63\u5728\u66f4\u65b0\u660e\u7ec6...</span></div>' : analyticsTableHtml(rows, s);
  const advancedHtml = deferHeavy ? '' : analyticsAdvancedHtml(rows, s);
  return `${headerHtml(false)}<div id="analyticsFiltersSlot">${filtersHtml(s)}</div><div id="analyticsSummarySlot">${renderSummary(rows, s)}</div><div id="analyticsEmptySlot">${analyticsEmptyState(rows)}</div><div id="analyticsChartSlot">${renderChart(rows, s)}</div><div id="analyticsAgentSlot">${renderAgentRhythm(s)}</div><div id="analyticsTableSlot">${tableHtml}</div><div id="analyticsAdvancedSlot">${advancedHtml}</div>`;
}
function patchChartChrome(rows, s){
  const slot = document.getElementById('analyticsChartSlot');
  const canvas = document.getElementById('usageChart');
  if(!slot || !canvas || !document.createElement) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderChart(rows, s);
  const nextHead = tmp.querySelector?.('.card-head');
  const currentHead = slot.querySelector?.('.card-head');
  if(nextHead && currentHead && currentHead.innerHTML !== nextHead.innerHTML) currentHead.innerHTML = nextHead.innerHTML;
  const nextUnderbar = tmp.querySelector?.('.chart-underbar');
  const currentUnderbar = slot.querySelector?.('.chart-underbar');
  if(nextUnderbar && currentUnderbar && chartPinnedIndex < 0 && currentUnderbar.innerHTML !== nextUnderbar.innerHTML) currentUnderbar.innerHTML = nextUnderbar.innerHTML;
  const nextScrubber = tmp.querySelector?.('#chartHoverScrubber');
  const currentScrubber = document.getElementById('chartHoverScrubber');
  if(nextScrubber && currentScrubber && chartPinnedIndex < 0 && currentScrubber.innerHTML !== nextScrubber.innerHTML) currentScrubber.innerHTML = nextScrubber.innerHTML;
  return true;
}
function patchAnalyticsView(s, rows, opts = {}){
  if(!analyticsSlotsReady()) return false;
  patchHtmlSlot('analyticsFiltersSlot', filtersHtml(s));
  patchHtmlSlot('analyticsSummarySlot', renderSummary(rows, s));
  patchHtmlSlot('analyticsEmptySlot', analyticsEmptyState(rows));
  patchChartChrome(rows, s);
  patchHtmlSlot('analyticsAgentSlot', renderAgentRhythm(s));
  const token = ++analyticsDeferredToken;
  if(opts.deferHeavy === true){
    patchHtmlSlot('analyticsTableSlot', '<div id="analyticsDeferred" class="analytics-deferred"><span>\u6b63\u5728\u66f4\u65b0\u660e\u7ec6...</span></div>');
    patchHtmlSlot('analyticsAdvancedSlot', '');
    setTimeout(() => {
      if(token !== analyticsDeferredToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
      patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
      patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
      bindIncrementalTables();
    }, 35);
  } else {
    patchHtmlSlot('analyticsTableSlot', analyticsTableHtml(rows, s));
    patchHtmlSlot('analyticsAdvancedSlot', analyticsAdvancedHtml(rows, s));
  }
  return true;
}
function updateLimitNote(kind, rendered, total){
  const note = document.querySelector(`[data-table-limit="${kind}"]`);
  if(!note) return;
  if(rendered >= total){ note.remove?.(); return; }
  note.dataset.rendered = String(rendered);
  note.dataset.total = String(total);
  const suffix = kind === 'sessions' ? '行，滚动到底部继续加载，或继续搜索 / 筛选缩小范围。' : '行，滚动到底部继续加载，或继续搜索缩小范围。';
  note.textContent = `已先渲染 ${n(rendered)} / ${n(total)} ${suffix}`;
}
function appendRequestRows(){
  if(!snapshot?.ok) return false;
  const tbody = document.querySelector('.request-main tbody');
  if(!tbody || typeof tbody.insertAdjacentHTML !== 'function') return render(snapshot, { windowLayout:false, instantChart:true, partial:true });
  const started = perfNow();
  const rows = applyTableSearch(filterRows(snapshot));
  const before = Math.max(100, Number(requestTableRenderLimit || 100));
  const next = Math.min(before + 100, rows.length, 5000);
  if(next <= before) return false;
  const chunk = rows.slice(before, next).map(requestRowHtml).join('');
  if(chunk) tbody.insertAdjacentHTML('beforeend', chunk);
  requestTableRenderLimit = next;
  updateLimitNote('requests', next, rows.length);
  console.debug(`[dashboard] append request rows ${Math.round(perfNow() - started)}ms rows=${before}->${next}/${rows.length}`);
  return true;
}
function appendSessionRows(){
  if(!snapshot?.ok) return false;
  const tbody = document.querySelector('.session-scroll tbody');
  if(!tbody || typeof tbody.insertAdjacentHTML !== 'function') return render(snapshot, { windowLayout:false, instantChart:true });
  const started = perfNow();
  const rows = sortSessions((snapshot.sessions || []).filter(sessionMatches));
  const before = Math.max(80, Number(sessionTableRenderLimit || 80));
  const next = Math.min(before + 80, rows.length, 5000);
  if(next <= before) return false;
  const chunkItems = rows.slice(before, next);
  const chunk = chunkItems.map((item) => sessionRowHtml(item, false)).join('');
  if(chunk) tbody.insertAdjacentHTML('beforeend', chunk);
  sessionTableRenderLimit = next;
  sessionTableItems = rows.slice(0, next);
  updateLimitNote('sessions', next, rows.length);
  const rowCount = document.querySelector('.session-toolbar .row-count');
  if(rowCount) rowCount.textContent = `${n(sessionTableItems.length)} ${TXT.rows}`;
  console.debug(`[dashboard] append session rows ${Math.round(perfNow() - started)}ms rows=${before}->${next}/${rows.length}`);
  return true;
}

function patchSessionInspector(){
  const slot = document.getElementById('sessionInspectorSlot');
  if(!slot) return false;
  slot.innerHTML = renderSessionInspector();
  document.querySelectorAll('.session-row.selected').forEach((row) => row.classList.remove('selected'));
  let active = null;
  document.querySelectorAll('[data-session-select]').forEach((row) => { if(row.dataset.sessionSelect === selectedSessionId) active = row; });
  active?.classList?.add('selected');
  return true;
}

function perfPanelHtml(){
  const p = lastRenderPerf || {};
  return `<div id="perfPanel" class="perf-panel ${perfPanelOpen ? 'show' : ''}"><b>Renderer perf</b><span>total ${p.totalMs ?? '-'}ms</span><span>filter ${p.filterMs ?? 0}ms</span><span>chart ${p.chartDrawMs ?? 0}ms</span><span>dom ${p.domCommitMs ?? 0}ms</span><span>table ${p.tableRenderMs ?? 0}ms</span><span>lower ${p.lowerRenderMs ?? 0}ms</span><em>${esc(p.label || viewModeKey())}</em></div>`;
}
function updatePerfPanel(){
  let panel = document.getElementById('perfPanel');
  if(!perfPanelOpen){ panel?.remove?.(); return; }
  if(!panel){ document.body?.insertAdjacentHTML?.('beforeend', perfPanelHtml()); return; }
  panel.outerHTML = perfPanelHtml();
}
function togglePerfPanel(){
  perfPanelOpen = !perfPanelOpen;
  localStorage.setItem('perfPanelOpen', perfPanelOpen ? '1' : '0');
  updatePerfPanel();
}
