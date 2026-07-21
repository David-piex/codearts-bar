function perfNow(){ try { return performance.now(); } catch { return Date.now(); } }
function perfBucket(label){ currentRenderPerf = { label, startedAt: perfNow(), filterMs: 0, chartDrawMs: 0, domCommitMs: 0, tableRenderMs: 0, lowerRenderMs: 0, rows: 0 }; return currentRenderPerf; }
function markPerfStage(key, ms){ if(!currentRenderPerf || !Number.isFinite(ms)) return; currentRenderPerf[key] = Math.round((currentRenderPerf[key] || 0) + ms); }
function finishPerfBucket(rows = 0){ if(!currentRenderPerf) return null; currentRenderPerf.totalMs = Math.round(perfNow() - currentRenderPerf.startedAt); currentRenderPerf.rows = rows; lastRenderPerf = currentRenderPerf; currentRenderPerf = null; try { window.__dashboardPerf = (window.__dashboardPerf || []).concat(lastRenderPerf).slice(-40); document.body?.dataset && (document.body.dataset.renderMs = String(lastRenderPerf.totalMs)); } catch {} return lastRenderPerf; }
function recordPatchPerf(label, startedAt, rows = 0, fields = {}){
  const totalMs = Math.round(perfNow() - startedAt);
  lastRenderPerf = {
    label,
    startedAt,
    filterMs: 0,
    chartDrawMs: 0,
    domCommitMs: 0,
    tableRenderMs: 0,
    lowerRenderMs: 0,
    rows,
    ...fields,
    totalMs,
  };
  try { window.__dashboardPerf = (window.__dashboardPerf || []).concat(lastRenderPerf).slice(-40); document.body?.dataset && (document.body.dataset.renderMs = String(totalMs)); } catch {}
  updatePerfPanel();
  return lastRenderPerf;
}
function resetIncrementalRenderLimits(scope = 'all'){
  if(scope === 'all' || scope === 'requests'){
    requestTableRenderLimit = REQUEST_PAGE_SIZE;
    requestTablePage = 0;
    requestPageCache = { key: '', items: null, total: 0, page: 0, timestamp: 0 };
    persistStateNow('requestTablePage', '0');
  }
  if(scope === 'all' || scope === 'sessions') sessionTableRenderLimit = SESSION_PAGE_SIZE;
}
function commitAppHtml(app, html){
  const next = String(html ?? '');
  if(lastCommittedHtml === next) return false;
  lastCommittedHtml = next;
  try { slotHtmlCache?.clear?.(); } catch {}
  app.innerHTML = next;
  return true;
}
function markRenderCost(start, label, rows = 0){
  const perf = finishPerfBucket(rows);
  lastRenderCost = perf ? perf.totalMs : Math.round(perfNow() - start);
  try { document.body?.style?.setProperty?.('--last-render-ms', `${lastRenderCost}ms`); } catch {}
  const detail = perf ? ` filter=${perf.filterMs || 0}ms chart=${perf.chartDrawMs || 0}ms dom=${perf.domCommitMs || 0}ms table=${perf.tableRenderMs || 0}ms lower=${perf.lowerRenderMs || 0}ms` : '';
  if(lastRenderCost > 120 || label === 'switch'){
    console.debug(`[dashboard] ${label} render ${lastRenderCost}ms rows=${rows}${detail}`);
    try { ipcRenderer.invoke('dashboard:log', { level: 'debug', scope: 'renderer-perf', message: `${label} render ${lastRenderCost}ms rows=${rows}${detail}` }); } catch {}
  }
  updatePerfPanel();
}
