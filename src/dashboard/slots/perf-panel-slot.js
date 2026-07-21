function perfPanelRate(value){
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : '-';
}
function perfPanelCount(value){
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '-';
}
function perfPanelMs(value){
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}ms` : '-';
}
function perfPanelRow(label, value, tone = ''){
  return `<span class="${tone ? `perf-${esc(tone)}` : ''}"><i>${esc(label)}</i><strong>${esc(value)}</strong></span>`;
}
function perfPanelSlowHint(perf = {}){
  const rollup = perf.usageRollup || {};
  const current = rollup.current || {};
  const slow = perf.slowAggregates || {};
  const pending = Number(rollup.pendingCount || 0);
  const misses = Number(rollup.misses || 0) + Number(rollup.invalid || 0);
  const failed = (current.status === 'failed' ? 1 : 0) + Number(slow.failed || 0);
  const maxMs = Number(slow.maxMs || 0);
  if(current.status === 'retrying') return { tone: 'warn', label: '后台恢复中', detail: '当前使用直接 SQL，sidecar 正在按退避策略重试' };
  if(failed > 0) return { tone: 'bad', label: '聚合异常', detail: '当前 rollup 构建失败或冷聚合失败，建议查看诊断中心' };
  if(maxMs >= 300) return { tone: 'warn', label: `冷聚合 ${perfPanelMs(maxMs)}`, detail: '当前使用 sidecar 回退或冷聚合较慢，建议等待缓存完成' };
  if(current.status === 'queued' || current.status === 'running' || pending > 0) return { tone: 'warn', label: `sidecar 构建中 ${perfPanelCount(current.percent ?? pending)}%`, detail: '后台正在生成使用量 rollup，当前数据由直接 SQL 提供' };
  if(misses > 0) return { tone: 'warn', label: `rollup miss ${perfPanelCount(misses)}`, detail: '部分时间桶未命中，已回退到实时聚合' };
  if(Number(rollup.reads || 0) > 0 || Number(perf.aggregateCache?.reads || 0) > 0) return { tone: 'ok', label: '缓存命中', detail: '聚合已命中 sidecar 或内存缓存' };
  return { tone: '', label: '等待数据', detail: '打开数据页后会显示数据层性能' };
}
function perfPanelResizeHtml(){
  let entry = null;
  try { entry = (window.__dashboardResizePerf || []).slice(-1)[0] || null; } catch {}
  if(!entry) return perfPanelRow('resize', '-');
  const marks = Array.isArray(entry.marks) ? entry.marks.map((m) => m.stage).filter(Boolean).slice(-4).join(' › ') : '';
  return `${perfPanelRow('resize', perfPanelMs(entry.totalMs), Number(entry.totalMs || 0) > 180 ? 'bad' : Number(entry.totalMs || 0) > 120 ? 'warn' : 'ok')}<em>${esc(marks || entry.reason || '')}</em>`;
}
function latestResizePerfEntry(){
  try { return (window.__dashboardResizePerf || []).slice(-1)[0] || null; } catch {}
  return null;
}
function safePerfClone(value){
  if(value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch {}
  return value;
}
function safeSourceSummary(s = snapshot || {}){
  return (Array.isArray(s.sources) ? s.sources : []).map((source) => ({
    id: source.id || source.source || '',
    label: source.label || source.id || source.source || '',
  }));
}
function perfPanelDiagnosticsHtml(){
  const perf = perfDiagnostics?.performance || {};
  const aggregate = perf.aggregateCache || {};
  const rollup = perf.usageRollup || {};
  const slow = perf.slowAggregates || {};
  const cold = perfPanelSlowHint(perf);
  const suffix = !perfDiagnostics && perfDiagnosticsLoading ? '<em>加载中</em>' : (!perfDiagnostics ? '<em>暂无诊断</em>' : '');
  const aggregateTone = Number(aggregate.hitRate || 0) >= 0.7 ? 'ok' : Number(aggregate.reads || 0) ? 'warn' : '';
  const rollupTone = Number(rollup.pendingCount || 0) > 0 ? 'warn' : Number(rollup.hitRate || 0) >= 0.7 ? 'ok' : Number(rollup.reads || 0) ? 'warn' : '';
  const slowTone = Number(slow.failed || 0) > 0 ? 'bad' : Number(slow.count || 0) > 0 ? 'warn' : '';
  const slowLabel = slow.last?.label
    ? `${slow.last.label} ${perfPanelMs(slow.last.ms)} / max ${perfPanelMs(slow.maxMs)}`
    : `${perfPanelCount(slow.count)} 次 / max ${perfPanelMs(slow.maxMs)}`;
  const adapterLabel = slow.last?.adapter ? `${slow.last.adapter} / ${slow.last?.scope || ''}` : (rollup.lastBuild?.adapter || rollup.lastBuildStatus || '');
  return `<div class="perf-section"><b>数据层</b>${perfPanelRow('冷聚合', cold.label, cold.tone)}<em>${esc(cold.detail)}</em>${perfPanelRow('聚合缓存', `${perfPanelRate(aggregate.hitRate)} · ${perfPanelCount(aggregate.size)}/${perfPanelCount(aggregate.limit)}`, aggregateTone)}${perfPanelRow('sidecar', `${perfPanelRate(rollup.hitRate)} · pending ${perfPanelCount(rollup.pendingCount)}`, rollupTone)}${perfPanelRow('rollup miss', `${perfPanelCount(rollup.misses)} / invalid ${perfPanelCount(rollup.invalid)}`)}${perfPanelRow('慢聚合', slowLabel, slowTone)}${adapterLabel ? `<em>${esc(adapterLabel)}</em>` : ''}${perfPanelRow('构建', `${perfPanelCount(rollup.buildCompleted)} ok / ${perfPanelCount(rollup.buildFailed)} fail`)}${perfPanelRow('last build', perfPanelMs(rollup.lastBuildMs), Number(rollup.lastBuildMs || 0) > 300 ? 'warn' : Number(rollup.lastBuildMs || 0) ? 'ok' : '')}${suffix}</div>`;
}
function refreshPerfDiagnostics(force = false){
  if(!perfPanelOpen || perfDiagnosticsLoading) return;
  const now = Date.now();
  if(!force && now - Number(perfDiagnosticsFetchedAt || 0) < 2500) return;
  perfDiagnosticsLoading = true;
  ipcRenderer.invoke('dashboard:getDiagnostics')
    .then((payload) => { perfDiagnostics = payload || null; perfDiagnosticsFetchedAt = Date.now(); })
    .catch(() => { perfDiagnostics = null; perfDiagnosticsFetchedAt = Date.now(); })
    .finally(() => { perfDiagnosticsLoading = false; updatePerfPanel(); });
}
function perfPanelHtml(){
  const p = lastRenderPerf || {};
  const total = Number(p.totalMs || 0);
  const tone = total > 120 ? 'bad' : total > 80 ? 'warn' : 'ok';
  return `<div id="perfPanel" class="perf-panel ${perfPanelOpen ? 'show' : ''}"><div class="perf-section"><b>渲染性能</b>${perfPanelRow('总耗时', p.totalMs == null ? '-' : `${p.totalMs}ms`, tone)}${perfPanelRow('筛选', `${p.filterMs ?? 0}ms`)}${perfPanelRow('图表', `${p.chartDrawMs ?? 0}ms`)}${perfPanelRow('Canvas', `${p.chartCanvasMs ?? 0}ms`)}${perfPanelRow('布局读取', `${p.chartLayoutReadMs ?? 0}ms`)}${perfPanelRow('DOM', `${p.domCommitMs ?? 0}ms`)}${perfPanelRow('表格', `${p.tableRenderMs ?? 0}ms`)}${perfPanelRow('下方区域', `${p.lowerRenderMs ?? 0}ms`)}<em>${esc(p.label || viewModeKey())}</em></div><div class="perf-section"><b>窗口</b>${perfPanelResizeHtml()}</div>${perfPanelDiagnosticsHtml()}<button class="perf-copy" data-copy-perf-report="1">${esc(TXT.copyPerfReport || '复制性能报告')}</button><em>Ctrl/⌘ + Shift + P 隐藏</em></div>`;
}
function updatePerfPanel(){
  let panel = document.getElementById('perfPanel');
  if(!perfPanelOpen){ panel?.remove?.(); return; }
  refreshPerfDiagnostics(false);
  if(!panel){ document.body?.insertAdjacentHTML?.('beforeend', perfPanelHtml()); return; }
  panel.outerHTML = perfPanelHtml();
}
function togglePerfPanel(){
  perfPanelOpen = !perfPanelOpen;
  persistStateNow('perfPanelOpen', perfPanelOpen ? '1' : '0');
  if(perfPanelOpen) refreshPerfDiagnostics(true);
  updatePerfPanel();
}
async function copyPerformanceReport(){
  let diagnostics = perfDiagnostics || null;
  try {
    diagnostics = await ipcRenderer.invoke('dashboard:getDiagnostics');
    perfDiagnostics = diagnostics || perfDiagnostics;
    perfDiagnosticsFetchedAt = Date.now();
  } catch {}
  const renderHistory = (() => { try { return (window.__dashboardPerf || []).slice(-12); } catch { return []; } })();
  const resizeHistory = (() => { try { return (window.__dashboardResizePerf || []).slice(-8); } catch { return []; } })();
  const s = snapshot || {};
  const payload = {
    time: new Date().toISOString(),
    app: 'CodeArts Bar',
    report: 'dashboard-performance',
    view: {
      workspaceMode,
      layoutMode,
      sourceFilter,
      modelFilter,
      rangeFilter,
      tableTab,
      zoom,
      requestPageSize: REQUEST_PAGE_SIZE,
      sessionPageSize: SESSION_PAGE_SIZE,
    },
    snapshot: {
      ok: Boolean(s.ok),
      timestamp: s.timestamp || null,
      requestTotal: s.requestTotal || (Array.isArray(s.requestLog) ? s.requestLog.length : 0),
      sessionTotal: s.sessionTotal || (Array.isArray(s.sessions) ? s.sessions.length : 0),
      sources: safeSourceSummary(s),
    },
    render: safePerfClone(lastRenderPerf),
    renderHistory: safePerfClone(renderHistory),
    resize: safePerfClone(latestResizePerfEntry()),
    resizeHistory: safePerfClone(resizeHistory),
    dataLayer: safePerfClone(diagnostics?.performance || perfDiagnostics?.performance || null),
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  toast(TXT.perfReportCopied || '性能报告已复制');
}
