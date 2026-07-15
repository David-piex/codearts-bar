readSessionMeta();
readSavedSessionViews();
document.addEventListener('keydown', (e) => {
  if(!exportDialog || e.key !== 'Escape') return;
  e.preventDefault();
  exportDialog = null;
  patchSessionModalOrRender();
});
applyZoom();
document.getElementById('refresh').onclick = refreshNow;
document.getElementById('settings').onclick = () => ipcRenderer.invoke('dashboard:settings');
const legacyLayoutButton = document.getElementById('layoutMode');
if(legacyLayoutButton) legacyLayoutButton.onclick = () => switchLayoutMode(layoutMode === 'compact' ? 'dashboard' : 'compact');
document.addEventListener('keydown', async (e) => { if((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key || '').toLowerCase() === 'p'){ e.preventDefault(); togglePerfPanel(); return; } if(e.key === 'Enter' && e.target.closest('[data-request-page-input]')){ e.preventDefault(); document.querySelector('[data-request-page-go]')?.click?.(); return; } if(e.key === 'Enter' && e.target.closest('[data-session-page-input]')){ e.preventDefault(); document.querySelector('[data-session-page-go]')?.click?.(); return; } if(dateRangeOpen && e.key === 'Escape'){ e.preventDefault(); dateRangeOpen = false; if(!patchDateRangeChrome?.() && snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); return; } if(e.key === 'Enter' && e.target.closest('[data-saved-session-name]')){ saveCurrentSessionView(); patchSessionsOrRender({ table: false, toolbar: true, inspector: false, overview: false }); return; } if(bulkMetaOpen && e.key === 'Escape'){ bulkMetaOpen = false; bulkMetaTagsDraft = ''; bulkMetaNoteDraft = ''; patchSessionModalOrRender(); return; } if(!renameSessionKey) return; if(e.key === 'Escape'){ renameSessionKey = ''; renameDraft = ''; patchSessionModalOrRender(); } if(e.key === 'Enter' && e.target.closest('[data-rename-input]')){ await saveRenameSheet(); } });
ipcRenderer.on('dashboard:snapshot', (_e, s) => { suppressChartIntro = true; applyRealtimeSnapshot(s); suppressChartIntro = false; setRefreshState(TXT.realtime); setTimeout(() => setRefreshState(''), 900); });
function beginResizePerf(reason = 'resize'){
  const now = perfNow();
  const current = resizePerfSession;
  const idleMs = current ? now - Number(current.lastAt || 0) : Infinity;
  const ageMs = current ? now - Number(current.startedAt || 0) : 0;
  const viewportNow = `${Math.round(Number(window.innerWidth || 0))}x${Math.round(Number(window.innerHeight || 0))}@${window.devicePixelRatio || 1}`;
  const viewportChanged = Boolean(current?.viewportStart && current.viewportStart !== viewportNow);
  const shouldStartFresh = !current
    || current.done
    || idleMs > 180
    || ageMs > 360
    || (reason === 'window' && ageMs > 96 && (idleMs > 24 || viewportChanged));
  if(shouldStartFresh){
    if(current && !current.done) finishResizePerf('resizeEnd', 'superseded');
    resizePerfSession = {
      id: `${Date.now()}-${Math.round(now * 1000)}`,
      reason,
      startedAt: now,
      startedWallAt: Date.now(),
      viewportStart: viewportNow,
      lastAt: now,
      marks: [{ stage: 'resizeStart', at: now, ms: 0, detail: reason }],
    };
  } else {
    resizePerfSession.reason = reason || resizePerfSession.reason;
    resizePerfSession.lastAt = now;
    resizePerfSession.marks.push({ stage: 'resizeEvent', at: now, ms: Math.round(now - resizePerfSession.startedAt), detail: reason });
  }
  try { document.body?.dataset && (document.body.dataset.resizePerf = 'active'); } catch {}
  return resizePerfSession;
}
function resizePerfSessionMatches(sessionId){
  return !sessionId || (resizePerfSession && resizePerfSession.id === sessionId && !resizePerfSession.done);
}
function markResizePerf(stage, detail = null, sessionId = null){
  if(!resizePerfSessionMatches(sessionId)) return;
  if(!resizePerfSession || resizePerfSession.done) return;
  const now = perfNow();
  resizePerfSession.lastAt = now;
  if(stage === 'resizeSettled') resizePerfSession.settled = true;
  resizePerfSession.marks.push({ stage, at: now, ms: Math.round(now - resizePerfSession.startedAt), detail });
}
function finishResizePerf(reason = 'resizeEnd', detail = null, sessionId = null){
  if(!resizePerfSessionMatches(sessionId)) return;
  if(!resizePerfSession || resizePerfSession.done) return;
  const now = perfNow();
  resizePerfSession.done = true;
  resizePerfSession.totalMs = Math.round(now - resizePerfSession.startedAt);
  resizePerfSession.marks.push({ stage: 'resizeEnd', at: now, ms: resizePerfSession.totalMs, detail: detail || reason });
  const entry = { reason: resizePerfSession.reason || reason, totalMs: resizePerfSession.totalMs, marks: resizePerfSession.marks.map((m) => ({ stage: m.stage, ms: m.ms, detail: m.detail || null })) };
  try { window.__dashboardResizePerf = (window.__dashboardResizePerf || []).concat(entry).slice(-24); } catch {}
  try { document.body?.dataset && (document.body.dataset.resizePerf = String(entry.totalMs)); } catch {}
  if(resizePerfLogTimer) clearTimeout(resizePerfLogTimer);
  resizePerfLogTimer = setTimeout(() => {
    resizePerfLogTimer = null;
    const summary = entry.marks.map((m) => `${m.stage}:${m.ms}ms${m.detail ? `(${m.detail})` : ''}`).join(' ');
    if(entry.totalMs > 90) console.debug(`[dashboard] resize ${entry.totalMs}ms ${summary}`);
    if(entry.totalMs > 120){
      try { ipcRenderer.invoke('dashboard:log', { level: 'debug', scope: 'renderer-resize-perf', message: `resize ${entry.totalMs}ms`, detail: entry }); } catch {}
    }
  }, 0);
}
function chartCanvasSizeKey(canvas, opts = {}){
  if(!canvas?.getBoundingClientRect) return '';
  const dpr = window.devicePixelRatio || 1;
  if(opts.force !== true && chartCanvasBoxCache?.key && Math.abs(Number(chartCanvasBoxCache.dpr || 0) - dpr) < 0.001) return chartCanvasBoxCache.key;
  const rect = canvas.getBoundingClientRect();
  if(typeof rememberChartCanvasBox === 'function') rememberChartCanvasBox(canvas, Number(rect.width || 0), Number(rect.height || 0), dpr, 'size-key');
  return `${Math.round(Number(rect.width || 0))}x${Math.round(Number(rect.height || 0))}@${dpr}`;
}
function chartCanvasSettledSizeKey(canvas){
  if(!canvas) return '';
  const dpr = window.devicePixelRatio || 1;
  const pendingKey = canvas.dataset?.pendingResizeKey || '';
  if(pendingKey) return pendingKey;
  const observed = chartResizeObservedCanvas === canvas && typeof ResizeObserver !== 'undefined';
  const cacheKey = chartCanvasBoxCache?.key || canvas.dataset?.sizeKey || '';
  const cacheDpr = Number(chartCanvasBoxCache?.dpr || canvas.dataset?.dpr || 0);
  const cacheFresh = Number(chartCanvasBoxCache?.timestamp || 0) >= Number(resizePerfSession?.startedWallAt || 0) - 8;
  const viewportNow = `${Math.round(Number(window.innerWidth || 0))}x${Math.round(Number(window.innerHeight || 0))}@${dpr}`;
  const viewportUnchanged = resizePerfSession?.viewportStart && resizePerfSession.viewportStart === viewportNow;
  if(cacheKey && Math.abs(cacheDpr - dpr) < 0.001){
    if(viewportUnchanged || (observed && cacheFresh)) return cacheKey;
  }
  return chartCanvasSizeKey(canvas, { force: true });
}
function markChartGeometryDirtyAfterResize(canvas, key){
  if(!canvas || !chartPoints?.length || !canvas.width || !canvas.height) return false;
  chartGeometryDirty = true;
  if(key) chartResizeSizeKey = key;
  return true;
}
function scheduleZoomSettledChartRedraw(){
  const sessionId = resizePerfSession?.id || null;
  if(chartZoomSettleTimer) clearTimeout(chartZoomSettleTimer);
  chartZoomSettleTimer = setTimeout(() => {
    if(!resizePerfSessionMatches(sessionId)) return;
    chartZoomSettleTimer = null;
    zoomInteractionUntil = 0;
    if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact'){ finishResizePerf('resizeEnd', 'inactive-view', sessionId); return; }
    const canvas = document.getElementById('usageChart');
    if(!canvas){ finishResizePerf('resizeEnd', 'no-canvas', sessionId); return; }
    requestAnimationFrame(() => {
      if(!resizePerfSessionMatches(sessionId)) return;
      if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact'){ finishResizePerf('zoomEnd', 'inactive-view', sessionId); return; }
      try { document.body?.classList?.remove?.('is-zooming'); } catch {}
      try { document.getElementById('app')?.classList?.remove?.('is-zooming'); } catch {}
      markResizePerf('resizeSettled', 'zoom', sessionId);
      const nextKey = chartCanvasSizeKey(canvas, { force: !chartCanvasBoxCache?.key });
      if(nextKey) chartResizeSizeKey = nextKey;
      markChartGeometryDirtyAfterResize(canvas, nextKey);
      const rows = getFilteredRowsForView(snapshot);
      if(typeof bindChart === 'function'){ bindChart(rows, snapshot, { instant: true, resize: true, settled: true }); markResizePerf('chartRedraw', 'zoomSettled', sessionId); finishResizePerf('zoomEnd', null, sessionId); }
      else if(typeof scheduleChartBind === 'function') scheduleChartBind(rows, snapshot, { instant: true, resize: true, settled: true }, 0, () => { markResizePerf('chartRedraw', 'zoomSettled', sessionId); finishResizePerf('zoomEnd', null, sessionId); });
      else { drawChart(rows, snapshot, chartPinnedIndex >= 0 ? chartPinnedIndex : -1, 1); markResizePerf('chartRedraw', 'zoomSettled', sessionId); finishResizePerf('zoomEnd', null, sessionId); }
    });
  }, 90);
}
function scheduleResizeSettledChartRedraw(reason = 'resize', sessionId = null, delayOverride = null){
  if(chartResizeSettleTimer) clearTimeout(chartResizeSettleTimer);
  const delay = delayOverride == null ? (reason === 'window' ? 32 : (reason === 'observer' ? 38 : 36)) : Math.max(0, Number(delayOverride || 0));
  chartResizeSettleTimer = setTimeout(() => {
    if(!resizePerfSessionMatches(sessionId)) return;
    chartResizeSettleTimer = null;
    const quietRemaining = Math.max(0, Number(chartResizeQuietUntil || 0) - Date.now());
    if(quietRemaining > 8){
      markResizePerf('resizeQuietWait', `${Math.round(quietRemaining)}ms`, sessionId);
      scheduleResizeSettledChartRedraw(reason, sessionId, Math.min(48, Math.max(10, quietRemaining)));
      return;
    }
    chartResizeQuietUntil = 0;
    try { document.body?.classList?.remove?.('is-resizing'); } catch {}
    try { document.getElementById('app')?.classList?.remove?.('is-resizing'); } catch {}
    markResizePerf('resizeSettled', reason, sessionId);
    if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact'){ finishResizePerf('resizeEnd', 'inactive-view', sessionId); return; }
    const canvas = document.getElementById('usageChart');
    if(!canvas){ finishResizePerf('resizeEnd', 'no-canvas', sessionId); return; }
    const nextKey = chartCanvasSettledSizeKey(canvas);
    if(nextKey && nextKey === chartResizeSizeKey){
      try { if(canvas.dataset) delete canvas.dataset.pendingResizeKey; } catch {}
      markResizePerf('sameSizeSkip', nextKey, sessionId);
      finishResizePerf('resizeEnd', 'same-size', sessionId);
      return;
    }
    if(nextKey) chartResizeSizeKey = nextKey;
    markChartGeometryDirtyAfterResize(canvas, nextKey);
    try { if(canvas.dataset) delete canvas.dataset.pendingResizeKey; } catch {}
    const rows = getFilteredRowsForView(snapshot);
    if(typeof bindChart === 'function'){ bindChart(rows, snapshot, { instant: true, resize: true, settled: true }); markResizePerf('chartRedraw', reason, sessionId); finishResizePerf('resizeEnd', null, sessionId); }
    else if(typeof scheduleChartBind === 'function') scheduleChartBind(rows, snapshot, { instant: true, resize: true, settled: true }, 0, () => { markResizePerf('chartRedraw', reason, sessionId); finishResizePerf('resizeEnd', null, sessionId); });
    else { drawChart(rows, snapshot, chartPinnedIndex >= 0 ? chartPinnedIndex : -1, 1); markResizePerf('chartRedraw', reason, sessionId); finishResizePerf('resizeEnd', null, sessionId); }
  }, delay);
}
function scheduleChartResizeRedraw(reason = 'resize'){
  const session = beginResizePerf(reason);
  const sessionId = session?.id || null;
  if(reason !== 'zoom' && chartZoomSettleTimer){
    clearTimeout(chartZoomSettleTimer);
    chartZoomSettleTimer = null;
  }
  const app = document.getElementById('app');
  const zoomActive = reason === 'zoom' || Date.now() < Number(zoomInteractionUntil || 0) || Boolean(document.body?.classList?.contains?.('is-zooming')) || Boolean(app?.classList?.contains?.('is-zooming'));
  if(!(zoomActive && (reason === 'zoom' || reason === 'observer'))){
    setInteractionMode(zoomActive ? 'is-zooming' : 'is-resizing', zoomActive ? 130 : 125);
    markResizePerf('domPatch', zoomActive ? 'is-zooming' : 'is-resizing', sessionId);
  }
  const chartActive = snapshot?.ok && workspaceMode === 'analytics' && layoutMode !== 'compact';
  if(resizeFrame){ cancelAnimationFrame(resizeFrame); resizeFrame = null; }
  if(resizeFrameTimer){ clearTimeout(resizeFrameTimer); resizeFrameTimer = null; }
  if(resizeTimer) clearTimeout(resizeTimer);
  if(reason === 'zoom'){
    scheduleZoomSettledChartRedraw();
    return;
  }
  chartResizeQuietUntil = Math.max(Number(chartResizeQuietUntil || 0), Date.now() + (reason === 'window' ? 54 : 50));
  if(!chartActive){
    scheduleResizeSettledChartRedraw(reason, sessionId);
    return;
  }
  scheduleResizeSettledChartRedraw(reason, sessionId);
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
    if(chartResizeSettleTimer && Date.now() < Number(chartResizeQuietUntil || 0)){
      markResizePerf('observerSize', key || 'pending', resizePerfSession?.id || null);
      return;
    }
    scheduleChartResizeRedraw('observer');
  });
  chartResizeObserver.observe(canvas);
}
window.addEventListener('resize', () => scheduleChartResizeRedraw('window'));
load();
