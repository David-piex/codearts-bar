function normalizeRangeFilter(value){ const raw = String(value || 'customTime'); if(raw === 'customTime') return raw; if(raw === 'custom') return `${Math.max(2, Math.min(365, Number(localStorage.getItem('customRangeDays') || '60') || 60))}d`; if(raw === 'all' || raw === 'today') return raw; const days = Number(raw.replace('d', '')); return Number.isFinite(days) && days > 0 ? `${Math.max(1, Math.min(365, Math.round(days)))}d` : 'customTime'; }
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
function saveVisibleSeries(){ ensureVisibleSeries(); localStorage.setItem('chartSeries', [...visibleSeries].join(',')); }
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
  localStorage.setItem('uiZoom', String(zoom));
}
function n(v){ return fmt.format(Math.round(Number(v) || 0)); }
function compact(v){ v = Number(v) || 0; if(Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}\u4ebf`; if(Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)}\u4e07`; return n(v); }
function emptyMetric(){ return TXT.noData || '\u65e0\u6570\u636e'; }
function ms(v){ if(v == null || v === '') return emptyMetric(); v = Number(v); if(!Number.isFinite(v)) return emptyMetric(); if(v < 1000) return `${Math.round(v)}ms`; return `${(v / 1000).toFixed(v < 10000 ? 2 : 1)}s`; }
function rate(v){ if(v == null || v === '') return emptyMetric(); v = Number(v); return Number.isFinite(v) ? `${v.toFixed(v < 10 ? 2 : 1)} token/s` : emptyMetric(); }
function percent(v){ if(v == null || v === '') return emptyMetric(); v = Number(v); if(!Number.isFinite(v)) return emptyMetric(); return `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%`; }
function cacheHitDenominator(st){ return Number(st?.input || 0) + Number(st?.cacheRead || 0); }
function cacheHitRate(st){ const read = Number(st?.cacheRead || 0); const total = cacheHitDenominator(st); return total > 0 ? (read / total) * 100 : null; }
function cacheHitText(st){ return percent(cacheHitRate(st)); }
function cacheHitBasis(st){ const read = Number(st?.cacheRead || 0); const total = cacheHitDenominator(st); return `${compact(read)} / ${compact(total)}`; }
function cacheTokenTotal(st){ return Number(st?.cacheRead || 0) + Number(st?.cacheWrite || 0); }
function cacheCoverageRate(st){ const read = Number(st?.cacheRead || 0); const input = Number(st?.input || 0); const total = read + input; return total > 0 ? (read / total) * 100 : null; }
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
function saveSessionMeta(){ localStorage.setItem('sessionMeta', JSON.stringify(sessionMeta)); }
function readSavedSessionViews(){ try { const parsed = JSON.parse(localStorage.getItem('savedSessionViews') || '[]'); savedSessionViews = Array.isArray(parsed) ? parsed : []; } catch { savedSessionViews = []; } }
function saveSavedSessionViews(){ localStorage.setItem('savedSessionViews', JSON.stringify(savedSessionViews.slice(0, 24))); }
function shortModel(model){ const p = String(model || 'unknown').split('/'); return p.slice(-1)[0] || 'unknown'; }
