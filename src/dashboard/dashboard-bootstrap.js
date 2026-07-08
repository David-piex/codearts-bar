function syncFooter(){
  const btn = document.getElementById('layoutMode');
  if(btn) btn.textContent = layoutMode === 'compact' ? TXT.dashboardMode : TXT.menuCardMode;
  document.body?.classList?.toggle?.('compact-layout', layoutMode === 'compact');
}
function switchLayoutMode(nextMode, renderOptions = {}){
  const next = nextMode === 'compact' ? 'compact' : 'dashboard';
  if(layoutMode === next){
    syncFooter();
    applyCompactWindowChrome();
    return;
  }
  layoutMode = next;
  localStorage.setItem('layoutMode', layoutMode);
  if(snapshot?.ok) render(snapshot, renderOptions);
  else syncFooter();
}
function applyWindowLayout(){
  const target = layoutMode === 'compact' ? 'compact' : 'dashboard';
  if(lastWindowLayoutApplied === target) return;
  lastWindowLayoutApplied = target;
  ipcRenderer.invoke('dashboard:setLayoutMode', target).catch(() => {});
}
function applyCompactWindowChrome(){
  document.body?.classList?.toggle?.('compact-pinned', compactPinned);
  if(layoutMode === 'compact'){
    ipcRenderer.invoke('dashboard:setPinned', compactPinned).catch(() => {});
  } else {
    ipcRenderer.invoke('dashboard:setPinned', false).catch(() => {});
  }
}
function viewModeKey(){ return layoutMode === 'compact' ? `compact:${compactPane}` : workspaceMode; }

function aggregatePayloadForView(s, extra = {}){
  const start = rangeFilter === 'all' ? 0 : sinceForRange(s);
  const end = untilForRange(s) || Number(s?.timestamp || Date.now());
  return {
    source: sourceFilter,
    model: modelFilter,
    range: { start, end },
    start,
    end,
    timestamp: Number(s?.timestamp || Date.now()),
    windowHours: Number(s?.config?.windowHours || 24),
    ...extra,
  };
}
function scheduleDashboardAggregates(s, opts = {}){
  if(opts.skipAggregates || !s?.ok || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
  if(aggregateRefreshTimer) clearTimeout(aggregateRefreshTimer);
  const token = ++aggregateRefreshToken;
  aggregateRefreshTimer = setTimeout(() => refreshDashboardAggregates(s, token), 45);
}
async function refreshDashboardAggregates(s, token){
  try {
    const dayMode = isDayRange();
    const bucketMs = dayMode ? 86400000 : 3600000;
    const basePayload = aggregatePayloadForView(s, { bucketMs });
    const [summary, trend, sourceStats, modelStats, sessionSummary] = await Promise.all([
      ipcRenderer.invoke('dashboard:getSummary', basePayload),
      ipcRenderer.invoke('dashboard:getTrendBuckets', basePayload),
      ipcRenderer.invoke('dashboard:getSourceStats', basePayload),
      ipcRenderer.invoke('dashboard:getModelStats', basePayload),
      ipcRenderer.invoke('dashboard:getSessionSummary', basePayload),
    ]);
    if(token !== aggregateRefreshToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
    let changed = false;
    if(summary?.ok && summary.usage){ s.usage = summary.usage; changed = true; }
    if(trend?.ok && Array.isArray(trend.buckets)){
      s.trends = { ...(s.trends || {}) };
      if(dayMode) s.trends.daily14d = trend.buckets;
      else s.trends.hourly24h = trend.buckets;
      s.trendsSource = 'db-aggregate';
      changed = true;
    }
    if(sourceStats?.ok && Array.isArray(sourceStats.items)){ s.sourceStats = sourceStats.items; changed = true; }
    if(modelStats?.ok && Array.isArray(modelStats.items)){ s.models = modelStats.items.slice(0, 12); changed = true; }
    if(sessionSummary?.ok){ s.sessionSummary = sessionSummary; changed = true; }
    if(changed) render(s, { windowLayout: false, instantChart: true, partial: true, skipAggregates: true });
  } catch (error) {
    ipcRenderer.invoke('dashboard:log', { level: 'warn', scope: 'renderer:aggregates', message: error.message }).catch(() => {});
  }
}


function setRefreshState(text){ const el = document.getElementById('refreshState'); if(el) el.textContent = text || ''; }
function applyCustomDateInputs(){
  if(dateRangeDraftStart) customDateStart = dateRangeDraftStart;
  if(dateRangeFollowNow) customDateEnd = Number(snapshot?.timestamp || Date.now());
  else if(dateRangeDraftEnd) customDateEnd = dateRangeDraftEnd;
  normalizeCustomDateRange(snapshot || {});
  rangeFilter = 'customTime';
  localStorage.setItem('statsRange', rangeFilter);
  localStorage.setItem('customDateStart', String(customDateStart));
  localStorage.setItem('customDateEnd', String(customDateEnd));
  localStorage.setItem('dateRangeFollowNow', dateRangeFollowNow ? '1' : '0');
}
function setupAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); const sec = Math.max(5, Number(refreshEvery) || 30); autoRefreshTimer = setInterval(refreshNow, sec * 1000); }
async function load(){ setRefreshState(TXT.refresh); const first = await ipcRenderer.invoke('dashboard:getSnapshot'); render(first); if(!first?.ok) await refreshNow(); setupAutoRefresh(); }
async function refreshNow(opts = {}){ setRefreshState(TXT.refresh); render(await ipcRenderer.invoke('dashboard:refresh'), opts && opts.type ? {} : opts); setRefreshState(TXT.refreshed); setTimeout(() => setRefreshState(''), 800); }
