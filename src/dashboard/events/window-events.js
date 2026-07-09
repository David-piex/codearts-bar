readSessionMeta();
readSavedSessionViews();
applyZoom();
document.getElementById('refresh').onclick = refreshNow;
document.getElementById('settings').onclick = () => ipcRenderer.invoke('dashboard:settings');
const legacyLayoutButton = document.getElementById('layoutMode');
if(legacyLayoutButton) legacyLayoutButton.onclick = () => switchLayoutMode(layoutMode === 'compact' ? 'dashboard' : 'compact');
document.addEventListener('keydown', async (e) => { if((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key || '').toLowerCase() === 'p'){ e.preventDefault(); togglePerfPanel(); return; } if(dateRangeOpen && e.key === 'Escape'){ dateRangeOpen = false; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); return; } if(e.key === 'Enter' && e.target.closest('[data-saved-session-name]')){ saveCurrentSessionView(); patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false }); return; } if(bulkMetaOpen && e.key === 'Escape'){ bulkMetaOpen = false; bulkMetaTagsDraft = ''; bulkMetaNoteDraft = ''; patchSessionModalOrRender(); return; } if(!renameSessionKey) return; if(e.key === 'Escape'){ renameSessionKey = ''; renameDraft = ''; patchSessionModalOrRender(); } if(e.key === 'Enter' && e.target.closest('[data-rename-input]')){ await saveRenameSheet(); } });
ipcRenderer.on('dashboard:snapshot', (_e, s) => { suppressChartIntro = true; render(mergeLightSnapshotPayload(snapshot, s), { instantChart: true, windowLayout: false, partial: true, immediate: true }); suppressChartIntro = false; setRefreshState(TXT.realtime); setTimeout(() => setRefreshState(''), 900); });
function chartCanvasSizeKey(canvas, opts = {}){
  if(!canvas?.getBoundingClientRect) return '';
  const dpr = window.devicePixelRatio || 1;
  if(opts.force !== true && chartCanvasBoxCache?.key && Math.abs(Number(chartCanvasBoxCache.dpr || 0) - dpr) < 0.001) return chartCanvasBoxCache.key;
  const rect = canvas.getBoundingClientRect();
  if(typeof rememberChartCanvasBox === 'function') rememberChartCanvasBox(canvas, Number(rect.width || 0), Number(rect.height || 0), dpr, 'size-key');
  return `${Math.round(Number(rect.width || 0))}x${Math.round(Number(rect.height || 0))}@${dpr}`;
}
function markChartGeometryDirtyAfterResize(canvas, key){
  if(!canvas || !chartPoints?.length || !canvas.width || !canvas.height) return false;
  chartGeometryDirty = true;
  if(key) chartResizeSizeKey = key;
  return true;
}
function scheduleZoomSettledChartRedraw(){
  if(chartZoomSettleTimer) clearTimeout(chartZoomSettleTimer);
  chartZoomSettleTimer = setTimeout(() => {
    chartZoomSettleTimer = null;
    zoomInteractionUntil = 0;
    if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact') return;
    const canvas = document.getElementById('usageChart');
    if(!canvas) return;
    requestAnimationFrame(() => {
      if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact') return;
      const nextKey = chartCanvasSizeKey(canvas, { force: !chartCanvasBoxCache?.key });
      if(nextKey) chartResizeSizeKey = nextKey;
      if(markChartGeometryDirtyAfterResize(canvas, nextKey)) return;
      const rows = getFilteredRowsForView(snapshot);
      if(typeof scheduleChartBind === 'function') scheduleChartBind(rows, snapshot, { instant: true, resize: true, settled: true }, 120);
      else drawChart(rows, snapshot, chartPinnedIndex >= 0 ? chartPinnedIndex : -1, 1);
    });
  }, 120);
}
function scheduleResizeSettledChartRedraw(reason = 'resize'){
  if(chartResizeSettleTimer) clearTimeout(chartResizeSettleTimer);
  const delay = 160;
  chartResizeSettleTimer = setTimeout(() => {
    chartResizeSettleTimer = null;
    chartResizeQuietUntil = 0;
    try { document.body?.classList?.remove?.('is-resizing'); } catch {}
    try { document.getElementById('app')?.classList?.remove?.('is-resizing'); } catch {}
    if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact') return;
    const canvas = document.getElementById('usageChart');
    if(!canvas) return;
    const nextKey = chartCanvasSizeKey(canvas, { force: true });
    if(nextKey && nextKey === chartResizeSizeKey) return;
    if(nextKey) chartResizeSizeKey = nextKey;
    if(markChartGeometryDirtyAfterResize(canvas, nextKey)) return;
    const rows = getFilteredRowsForView(snapshot);
    if(typeof scheduleChartBind === 'function') scheduleChartBind(rows, snapshot, { instant: true, resize: true, settled: true }, 140);
    else drawChart(rows, snapshot, chartPinnedIndex >= 0 ? chartPinnedIndex : -1, 1);
  }, delay);
}
function scheduleChartResizeRedraw(reason = 'resize'){
  if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact') return;
  if(reason !== 'zoom' && chartZoomSettleTimer){
    clearTimeout(chartZoomSettleTimer);
    chartZoomSettleTimer = null;
  }
  const app = document.getElementById('app');
  const zoomActive = reason === 'zoom' || Date.now() < Number(zoomInteractionUntil || 0) || Boolean(document.body?.classList?.contains?.('is-zooming')) || Boolean(app?.classList?.contains?.('is-zooming'));
  if(!(zoomActive && (reason === 'zoom' || reason === 'observer'))){
    setInteractionMode(zoomActive ? 'is-zooming' : 'is-resizing', zoomActive ? 150 : 140);
  }
  if(resizeFrame){ cancelAnimationFrame(resizeFrame); resizeFrame = null; }
  if(resizeFrameTimer){ clearTimeout(resizeFrameTimer); resizeFrameTimer = null; }
  if(resizeTimer) clearTimeout(resizeTimer);
  if(reason === 'zoom'){
    scheduleZoomSettledChartRedraw();
    return;
  }
  chartResizeQuietUntil = Math.max(Number(chartResizeQuietUntil || 0), Date.now() + 160);
  scheduleResizeSettledChartRedraw(reason);
}
function ensureChartResizeObserver(){
  const canvas = document.getElementById('usageChart');
  if(!canvas || typeof ResizeObserver === 'undefined') return;
  if(chartResizeObservedCanvas === canvas) return;
  try { chartResizeObserver?.disconnect?.(); } catch {}
  chartResizeObservedCanvas = canvas;
  chartResizeSizeKey = chartCanvasSizeKey(canvas, { force: false });
  chartResizeObserver = new ResizeObserver((entries) => {
    const entry = entries && entries[0];
    const rect = entry?.contentRect;
    const dpr = window.devicePixelRatio || 1;
    const key = rect ? `${Math.round(Number(rect.width || 0))}x${Math.round(Number(rect.height || 0))}@${dpr}` : '';
    if(key && (key === chartResizeSizeKey || canvas.dataset?.pendingResizeKey === key)) return;
    try { if(canvas.dataset && key) canvas.dataset.pendingResizeKey = key; } catch {}
    if(rect && typeof rememberChartCanvasBox === 'function'){
      rememberChartCanvasBox(canvas, Number(rect.width || 0), Number(rect.height || 0), dpr, 'observer');
    }
    if(Date.now() < Number(zoomInteractionUntil || 0)) return;
    scheduleChartResizeRedraw('observer');
  });
  chartResizeObserver.observe(canvas);
}
window.addEventListener('resize', () => scheduleChartResizeRedraw('window'));
load();
