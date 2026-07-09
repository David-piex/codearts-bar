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
  try {
    document.getElementById('app')?.classList?.add?.('view-switching');
    setAppInteractionMode('view-switching', 200);
  } catch {}
  const opts = { instantChart: true, ...renderOptions };
  if(next === 'dashboard' && renderOptions.deferHeavy === true) opts.deferHeavy = true;
  if(snapshot?.ok) render(snapshot, opts);
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

function mergeByKey(prev = [], next = [], keyFor){
  const map = new Map();
  for(const item of Array.isArray(prev) ? prev : []){
    try { map.set(keyFor(item), item); } catch {}
  }
  for(const item of Array.isArray(next) ? next : []){
    try { map.set(keyFor(item), item); } catch {}
  }
  return [...map.values()];
}
function mergeLightSnapshotPayload(current, incoming){
  if(!incoming?.ok || !incoming.lightRefresh || !current?.ok) return incoming;
  const merged = { ...current, ...incoming };
  const oldRequests = Array.isArray(current.requestLog) ? current.requestLog : [];
  const newRequests = Array.isArray(incoming.requestLog) ? incoming.requestLog : [];
  const oldSessions = Array.isArray(current.sessions) ? current.sessions : [];
  const newSessions = Array.isArray(incoming.sessions) ? incoming.sessions : [];
  if(oldRequests.length > newRequests.length){
    merged.requestLog = mergeByKey(oldRequests, newRequests, requestKeyFor).sort((a, b) => (b.time || 0) - (a.time || 0));
    merged.requestPage = incoming.requestPage || { items: newRequests, total: incoming.requestTotal ?? newRequests.length };
  }
  if(oldSessions.length > newSessions.length){
    merged.sessions = mergeByKey(oldSessions, newSessions, sessionKeyFor).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    merged.sessionPage = incoming.sessionPage || { items: newSessions, total: incoming.sessionTotal ?? newSessions.length };
  }
  return merged;
}
function shallowJsonEqual(a, b){
  try { return JSON.stringify(a || null) === JSON.stringify(b || null); } catch { return a === b; }
}
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
function dashboardPayloadForCurrentView(s = snapshot || { timestamp: Date.now(), config: { windowHours: 24 } }){
  return aggregatePayloadForView(s, {
    query: analyticsQuery,
    sessionQuery,
    status: sessionStatusFilter,
    project: sessionProjectFilter,
  });
}
function aggregateScopeForView(s = snapshot || {}){
  const bucketMs = isDayRange() ? 86400000 : 3600000;
  return trendScopeKey(aggregatePayloadForView(s, { bucketMs }));
}
function hasFreshAggregatesForView(s = snapshot || {}){
  if(!s?.aggregateScope || s.aggregateScope !== aggregateScopeForView(s)) return false;
  const age = Date.now() - Number(s.aggregateAt || s.timestamp || 0);
  return age >= 0 && age < 2500;
}
function scheduleDashboardAggregates(s, opts = {}){
  if(opts.skipAggregates || !s?.ok || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
  if(hasFreshAggregatesForView(s)) return;
  if(aggregateRefreshTimer) clearTimeout(aggregateRefreshTimer);
  const token = ++aggregateRefreshToken;
  aggregateRefreshTimer = setTimeout(() => refreshDashboardAggregates(s, token), 45);
}
async function refreshDashboardAggregates(s, token){
  try {
    const dayMode = isDayRange();
    const bucketMs = dayMode ? 86400000 : 3600000;
    const basePayload = aggregatePayloadForView(s, { bucketMs });
    const aggregate = await ipcRenderer.invoke('dashboard:getAggregates', basePayload);
    if(token !== aggregateRefreshToken || snapshot !== s || layoutMode !== 'dashboard' || workspaceMode !== 'analytics') return;
    const nextTrendScope = trendScopeKey(basePayload);
    if(aggregate?.ok){
      s.aggregateScope = nextTrendScope;
      s.aggregateAt = Date.now();
    }
    const changes = { summary: false, trend: false, sourceStats: false, modelStats: false, sessionSummary: false };
    let changed = false;
    if(aggregate?.ok && aggregate.usage && !shallowJsonEqual(s.usage, aggregate.usage)){ s.usage = aggregate.usage; changes.summary = true; changed = true; }
    if(aggregate?.ok && Array.isArray(aggregate.buckets)){
      const currentTrend = dayMode ? s.trends?.daily14d : s.trends?.hourly24h;
      if(!shallowJsonEqual(currentTrend, aggregate.buckets) || s.trendsScope !== nextTrendScope){
        s.trends = { ...(s.trends || {}) };
        if(dayMode) s.trends.daily14d = aggregate.buckets;
        else s.trends.hourly24h = aggregate.buckets;
        s.trendsSource = 'db-aggregate';
        s.trendsScope = nextTrendScope;
        changes.trend = true;
        changed = true;
      }
    }
    if(aggregate?.ok && Array.isArray(aggregate.sourceStats) && !shallowJsonEqual(s.sourceStats, aggregate.sourceStats)){ s.sourceStats = aggregate.sourceStats; changes.sourceStats = true; changed = true; }
    if(aggregate?.ok && Array.isArray(aggregate.modelStats) && !shallowJsonEqual(s.models, aggregate.modelStats.slice(0, 12))){
      s.models = aggregate.modelStats.slice(0, 12);
      try { memoForSnapshot(s).modelOptions = null; } catch {}
      changes.modelStats = true;
      changed = true;
    }
    if(aggregate?.ok && aggregate.sessionSummary && !shallowJsonEqual(s.sessionSummary, aggregate.sessionSummary)){ s.sessionSummary = aggregate.sessionSummary; changes.sessionSummary = true; changed = true; }
    if(changed){
      if(!patchDashboardAggregateSlots(s, changes)){
        render(s, { windowLayout: false, instantChart: true, partial: true, skipAggregates: true });
      }
    }
  } catch (error) {
    ipcRenderer.invoke('dashboard:log', { level: 'warn', scope: 'renderer:aggregates', message: error.message }).catch(() => {});
  }
}


function setRefreshState(text){ const el = document.getElementById('refreshState'); if(el) el.textContent = text || ''; }
function applyCustomDateInputs(){
  if(dateRangeDraftStart) customDateStart = dateRangeDraftStart;
  if(dateRangeDraftEnd) customDateEnd = dateRangeDraftEnd;
  dateRangeFollowNow = false;
  normalizeCustomDateRange(snapshot || {});
  rangeFilter = 'customTime';
  localStorage.setItem('statsRange', rangeFilter);
  localStorage.setItem('customDateStart', String(customDateStart));
  localStorage.setItem('customDateEnd', String(customDateEnd));
  localStorage.setItem('dateRangeFollowNow', '0');
}
function setupAutoRefresh(){ if(autoRefreshTimer) clearInterval(autoRefreshTimer); const sec = Math.max(5, Number(refreshEvery) || 30); autoRefreshTimer = setInterval(refreshNow, sec * 1000); }
async function load(){ setRefreshState(TXT.refresh); const first = await ipcRenderer.invoke('dashboard:getSnapshot', dashboardPayloadForCurrentView()); render(first, { immediate: true, instantChart: true }); if(!first?.ok) await refreshNow(); setupAutoRefresh(); }
async function refreshNow(opts = {}){
  setRefreshState(TXT.refresh);
  const payload = dashboardPayloadForCurrentView(snapshot?.ok ? snapshot : undefined);
  const channel = opts.full === true ? 'dashboard:refreshFull' : 'dashboard:refreshLight';
  const next = mergeLightSnapshotPayload(snapshot, await ipcRenderer.invoke(channel, payload));
  render(next, opts && opts.type ? {} : opts);
  setRefreshState(TXT.refreshed);
  setTimeout(() => setRefreshState(''), 800);
}
