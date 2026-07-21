function normalizeRangeFilter(value){ return normalizeRangeFilterValue(value, Number(localStorage.getItem('customRangeDays') || customRangeDays || 60)); }
const persistedStateMirror = new Map();
let persistedStateTimer = null;
function schedulePersistedStateFlush(){
  if(persistedStateTimer != null) return;
  const flush = () => { persistedStateTimer = null; flushPersistedState(); };
  if(typeof requestIdleCallback === 'function') persistedStateTimer = requestIdleCallback(flush, { timeout: 180 });
  else persistedStateTimer = setTimeout(flush, 0);
}
function persistState(key, value){
  if(!key) return value;
  persistedStateMirror.set(String(key), String(value ?? ''));
  syncDashboardStateSnapshot?.(key, value, false);
  schedulePersistedStateFlush();
  return value;
}
function persistStateNow(key, value){
  if(!key) return value;
  const normalizedKey = String(key);
  persistedStateMirror.delete(normalizedKey);
  try { localStorage.setItem(normalizedKey, String(value ?? '')); } catch {}
  syncDashboardStateSnapshot?.(normalizedKey, value, true);
  return value;
}
function persistStateBatch(entries){
  if(!entries) return;
  if(entries instanceof Map) entries.forEach((value, key) => persistState(key, value));
  else if(Array.isArray(entries)) entries.forEach((entry) => entry && persistState(entry[0], entry[1]));
  else Object.entries(entries).forEach(([key, value]) => persistState(key, value));
}
function flushPersistedState(){
  if(persistedStateTimer != null){
    try { if(typeof cancelIdleCallback === 'function') cancelIdleCallback(persistedStateTimer); else clearTimeout(persistedStateTimer); } catch {}
    persistedStateTimer = null;
  }
  for(const [key, value] of persistedStateMirror){
    try { localStorage.setItem(key, value); } catch {}
  }
  try { localStorage.setItem(DASHBOARD_STATE_SNAPSHOT_KEY, JSON.stringify({ version: 1, values: Object.fromEntries(dashboardStateSnapshot) })); } catch {}
  persistedStateMirror.clear();
}
const SERIES = [
  { key: 'total', label: TXT.total, color: COLORS.total, dash: [6, 5], kind: 'token' },
  { key: 'input', label: TXT.input, color: COLORS.input, dash: [], kind: 'token' },
  { key: 'output', label: TXT.output, color: COLORS.output, dash: [], kind: 'token' },
  { key: 'cacheRead', label: TXT.cacheRead, color: COLORS.cacheRead, dash: [], kind: 'token' },
];

function ensureVisibleSeries(){
  const allowed = new Set(['total', 'input', 'output', 'cacheRead']);
  for(const key of [...visibleSeries]) if(!allowed.has(key)) visibleSeries.delete(key);
  if(!visibleSeries.size) visibleSeries.add('total');
}
function saveVisibleSeries(){ ensureVisibleSeries(); persistStateNow('chartSeries', [...visibleSeries].join(',')); }
const interactionTimers = {};
function setInteractionMode(cls, ms = 160){
  try {
    const app = document.getElementById('app');
    document.body?.classList?.add?.(cls);
    app?.classList?.add?.(cls);
    clearTimeout(interactionTimers[cls]);
    interactionTimers[cls] = setTimeout(() => {
      document.body?.classList?.remove?.(cls);
      app?.classList?.remove?.(cls);
    }, ms);
  } catch {}
}
function setAppInteractionMode(cls, ms = 160){
  try {
    const app = document.getElementById('app');
    app?.classList?.add?.(cls);
    const key = `app:${cls}`;
    clearTimeout(interactionTimers[key]);
    interactionTimers[key] = setTimeout(() => app?.classList?.remove?.(cls), ms);
  } catch {}
}
function densityForZoom(value){
  const v = Number(value) || 1;
  if(v <= .94) return 'compact';
  if(v >= 1.08) return 'large';
  return 'normal';
}
function applyZoom(){
  zoom = Math.max(0.86, Math.min(1.28, Number(zoom) || 1));
  try {
    const nextDensity = densityForZoom(zoom);
    const previousDensity = document.body?.getAttribute?.('data-density') || 'normal';
    document.body?.style?.removeProperty?.('zoom');
    const densityChanged = previousDensity !== nextDensity;
    if(previousDensity !== nextDensity) document.body?.setAttribute?.('data-density', nextDensity);
    if(densityChanged){
      zoomInteractionUntil = Date.now() + 90;
      setInteractionMode('is-zooming', 90);
    }
    if(densityChanged){
      chartResizeSizeKey = '';
      if(typeof invalidateChartCanvasBox === 'function') invalidateChartCanvasBox();
      if(typeof scheduleChartResizeRedraw === 'function') scheduleChartResizeRedraw('zoom');
    }
  } catch {}
  persistStateNow('uiZoom', String(zoom));
}
function n(v){ return fmt.format(Math.round(Number(v) || 0)); }
function compact(v){ v = Number(v) || 0; if(Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}\u4ebf`; if(Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)}\u4e07`; return n(v); }
function emptyMetric(){ return TXT.noData || '\u65e0\u6570\u636e'; }
function ms(v){ if(v == null || v === '') return emptyMetric(); v = Number(v); if(!Number.isFinite(v)) return emptyMetric(); if(v < 1000) return `${Math.round(v)}ms`; return `${(v / 1000).toFixed(v < 10000 ? 2 : 1)}s`; }
function rate(v){ if(v == null || v === '') return emptyMetric(); v = Number(v); return Number.isFinite(v) ? `${v.toFixed(v < 10 ? 2 : 1)} token/s` : emptyMetric(); }
function percent(v){ if(v == null || v === '') return emptyMetric(); v = Number(v); if(!Number.isFinite(v)) return emptyMetric(); return `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%`; }
function cacheHitDenominator(st){ return CacheMetrics.cacheHitDenominator(st); }
function cacheHitRate(st){ return CacheMetrics.cacheHitRatePercent(st); }
function cacheHitText(st){ return percent(cacheHitRate(st)); }
function cacheHitBasis(st){ const basis = CacheMetrics.cacheHitBasis(st); return `${compact(basis.cacheRead)} / ${compact(basis.denominator)}`; }
function cacheTokenTotal(st){ return Number(st?.cacheRead || 0) + Number(st?.cacheWrite || 0); }
function cacheCoverageRate(st){ return CacheMetrics.cacheCoverageRatePercent(st); }
function cacheReuseValue(st){ const read = Number(st?.cacheRead || 0); const write = Number(st?.cacheWrite || 0); if(write > 0) return read / write; if(read > 0) return Infinity; return null; }
function multiple(v){ if(v == null || v === '') return emptyMetric(); if(v === Infinity) return '\u221ex'; v = Number(v); if(!Number.isFinite(v)) return emptyMetric(); return `${v.toFixed(v > 0 && v < 10 ? 2 : 1)}x`; }
function multipleUi(v){ if(v == null || v === '') return emptyMetric(); if(v === Infinity) return '\u9ad8\u590d\u7528'; return multiple(v); }
function cacheRingHtml(st, extra = ''){ const hit = cacheHitRate(st); const pct = Math.max(0, Math.min(100, Number.isFinite(hit) ? hit : 0)); return `<div class="cache-ring ${esc(extra)}" style="--hit:${pct}%"><b>${cacheHitText(st)}</b><small>${TXT.cacheHitRate}</small></div>`; }
function cachePillHtml(st){ const hit = cacheHitRate(st); const hitW = Math.max(0, Math.min(100, Number.isFinite(hit) ? hit : 0)); const tone = hit == null ? 'cold' : hit >= 60 ? 'hot' : hit >= 25 ? 'warm' : 'cold'; return `<span class="cache-pill ${tone}" style="--hit:${hitW}%" title="${TXT.cacheHitBasis} ${cacheHitBasis(st)}"><b>${cacheHitText(st)}</b><em>${cacheHitBasis(st)}</em><i></i></span>`; }
function cacheHealth(st){ const hit = cacheHitRate(st); if(hit == null) return { tone: 'cold', label: emptyMetric(), hint: TXT.cacheLowHint }; if(hit >= 60) return { tone: 'hot', label: '\u9ad8\u590d\u7528', hint: TXT.cacheHighHint }; if(hit >= 25) return { tone: 'warm', label: '\u6709\u590d\u7528', hint: TXT.cacheMidHint }; return { tone: 'cold', label: '\u5f85\u63d0\u5347', hint: TXT.cacheLowHint }; }
function cacheToneColor(st){ const tone = cacheHealth(st).tone; if(tone === 'hot') return COLORS.green; if(tone === 'warm') return '#f59e0b'; return COLORS.red; }
function cacheEfficiencyPanel(st, extra = ''){
  const read = Number(st?.cacheRead || 0);
  const write = Number(st?.cacheWrite || 0);
  const total = Math.max(1, read + write);
  const readW = Math.max(read ? 3 : 0, Math.min(100, (read / total) * 100));
  const writeW = Math.max(write ? 3 : 0, Math.min(100, (write / total) * 100));
  const hitW = Math.max(0, Math.min(100, cacheHitRate(st) || 0));
  const coverW = Math.max(0, Math.min(100, cacheCoverageRate(st) || 0));
  const health = cacheHealth(st);
  return `<div class="cache-eff-panel ${esc(extra)} ${health.tone}">${cacheRingHtml(st, 'cache-ring-large')}<div class="cache-facts"><div class="cache-fact cache-health-fact"><span>${TXT.cacheHealth}</span><strong>${health.label}</strong><i style="--w:${hitW}%; --c:${COLORS.purple}"></i></div><div class="cache-fact"><span>${TXT.cacheRead}</span><strong>${compact(read)}</strong><i style="--w:${readW}%; --c:${COLORS.cacheRead}"></i></div><div class="cache-fact"><span>${TXT.cacheWrite}</span><strong>${compact(write)}</strong><i style="--w:${writeW}%; --c:${COLORS.cacheWrite}"></i></div><div class="cache-fact"><span>${TXT.cacheReuse}</span><strong>${multiple(cacheReuseValue(st))}</strong><i style="--w:${hitW}%; --c:${COLORS.purple}"></i></div><div class="cache-fact"><span>${TXT.cacheCoverage}</span><strong>${percent(cacheCoverageRate(st))}</strong><i style="--w:${coverW}%; --c:${COLORS.green}"></i></div></div><p>${TXT.cacheSavedHint} &#183; ${TXT.cacheHitBasis} ${cacheHitBasis(st)} &#183; ${health.hint}</p></div>`;
}
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function readSessionMeta(){ try { sessionMeta = JSON.parse(localStorage.getItem('sessionMeta') || '{}') || {}; } catch { sessionMeta = {}; } }
let sessionMetaSaveTimer = null;
function saveSessionMeta(){
  if(sessionMetaSaveTimer) clearTimeout(sessionMetaSaveTimer);
  sessionMetaSaveTimer = null;
  persistState('sessionMeta', JSON.stringify(sessionMeta));
  flushPersistedState();
}
function scheduleSessionMetaSave(delay = 260){
  if(sessionMetaSaveTimer) clearTimeout(sessionMetaSaveTimer);
  sessionMetaSaveTimer = setTimeout(saveSessionMeta, Math.max(80, Number(delay) || 260));
}
function flushSessionMetaSave(){ if(sessionMetaSaveTimer) saveSessionMeta(); }
function readSavedSessionViews(){ try { const parsed = JSON.parse(localStorage.getItem('savedSessionViews') || '[]'); savedSessionViews = Array.isArray(parsed) ? parsed : []; } catch { savedSessionViews = []; } }
function saveSavedSessionViews(){ persistState('savedSessionViews', JSON.stringify(savedSessionViews.slice(0, 24))); flushPersistedState(); }
function shortModel(model){ const p = String(model || 'unknown').split('/'); return p.slice(-1)[0] || 'unknown'; }
