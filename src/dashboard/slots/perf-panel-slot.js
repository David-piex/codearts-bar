function perfPanelHtml(){
  const p = lastRenderPerf || {};
  return `<div id="perfPanel" class="perf-panel ${perfPanelOpen ? 'show' : ''}"><b>渲染性能</b><span>总耗时 ${p.totalMs ?? '-'}ms</span><span>筛选 ${p.filterMs ?? 0}ms</span><span>图表 ${p.chartDrawMs ?? 0}ms</span><span>Canvas ${p.chartCanvasMs ?? 0}ms</span><span>布局读取 ${p.chartLayoutReadMs ?? 0}ms</span><span>DOM ${p.domCommitMs ?? 0}ms</span><span>表格 ${p.tableRenderMs ?? 0}ms</span><span>下方区域 ${p.lowerRenderMs ?? 0}ms</span><em>${esc(p.label || viewModeKey())}</em></div>`;
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
