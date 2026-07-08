function normalizeRangeFilter(value){ const raw = String(value || 'customTime'); if(raw === 'customTime') return raw; if(raw === 'custom') return `${Math.max(2, Math.min(365, Number(localStorage.getItem('customRangeDays') || '60') || 60))}d`; if(raw === 'all' || raw === 'today') return raw; const days = Number(raw.replace('d', '')); return Number.isFinite(days) && days > 0 ? `${Math.max(1, Math.min(365, Math.round(days)))}d` : 'customTime'; }
const SERIES = [
  { key: 'total', label: TXT.total, color: COLORS.total, dash: [6, 5], kind: 'token' },
  { key: 'input', label: TXT.input, color: COLORS.input, dash: [], kind: 'token' },
  { key: 'output', label: TXT.output, color: COLORS.output, dash: [], kind: 'token' },
  { key: 'cacheWrite', label: TXT.cacheWrite, color: COLORS.cacheWrite, dash: [], kind: 'token' },
  { key: 'cacheRead', label: TXT.cacheRead, color: COLORS.cacheRead, dash: [], kind: 'token' },
  { key: 'cacheHitRate', label: TXT.cacheHitRate, color: COLORS.purple, dash: [3, 4], kind: 'pct' },
  { key: 'ttftMs', label: TXT.ttft, color: COLORS.wait, dash: [4, 4], kind: 'ms' },
  { key: 'waitMs', label: TXT.wait, color: COLORS.queue, dash: [7, 5], kind: 'ms' },
  { key: 'queueMs', label: TXT.queue, color: COLORS.purple || '#7c3aed', dash: [2, 5], kind: 'ms' },
];

function ensureVisibleSeries(){ const allowed = new Set(SERIES.map((x) => x.key)); for(const key of [...visibleSeries]) if(!allowed.has(key)) visibleSeries.delete(key); if(!visibleSeries.size) visibleSeries.add('total'); }
function saveVisibleSeries(){ ensureVisibleSeries(); localStorage.setItem('chartSeries', [...visibleSeries].join(',')); }
function applyZoom(){ zoom = Math.max(0.86, Math.min(1.28, Number(zoom) || 1)); document.body.style.zoom = zoom; localStorage.setItem('uiZoom', String(zoom)); }
function n(v){ return fmt.format(Math.round(Number(v) || 0)); }
function compact(v){ v = Number(v) || 0; if(Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}\u4ebf`; if(Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)}\u4e07`; return n(v); }
function ms(v){ if(v == null || v === '') return 'N/A'; v = Number(v); if(!Number.isFinite(v)) return 'N/A'; if(v < 1000) return `${Math.round(v)}ms`; return `${(v / 1000).toFixed(v < 10000 ? 2 : 1)}s`; }
function rate(v){ if(v == null || v === '') return 'N/A'; v = Number(v); return Number.isFinite(v) ? `${v.toFixed(v < 10 ? 2 : 1)} token/s` : 'N/A'; }
function percent(v){ if(v == null || v === '') return 'N/A'; v = Number(v); if(!Number.isFinite(v)) return 'N/A'; return `${v.toFixed(v > 0 && v < 10 ? 1 : 0)}%`; }
function cacheHitDenominator(st){ return Number(st?.input || 0) + Number(st?.cacheRead || 0) + Number(st?.cacheWrite || 0); }
function cacheHitRate(st){ const read = Number(st?.cacheRead || 0); const total = cacheHitDenominator(st); return total > 0 ? (read / total) * 100 : null; }
function cacheHitText(st){ return percent(cacheHitRate(st)); }
function cacheHitBasis(st){ const read = Number(st?.cacheRead || 0); const total = cacheHitDenominator(st); return `${compact(read)} / ${compact(total)}`; }
function cacheTokenTotal(st){ return Number(st?.cacheRead || 0) + Number(st?.cacheWrite || 0); }
function cacheCoverageRate(st){ const read = Number(st?.cacheRead || 0); const input = Number(st?.input || 0); const total = read + input; return total > 0 ? (read / total) * 100 : null; }
function cacheReuseValue(st){ const read = Number(st?.cacheRead || 0); const write = Number(st?.cacheWrite || 0); if(write > 0) return read / write; if(read > 0) return Infinity; return null; }
function multiple(v){ if(v == null || v === '') return 'N/A'; if(v === Infinity) return '\u221ex'; v = Number(v); if(!Number.isFinite(v)) return 'N/A'; return `${v.toFixed(v > 0 && v < 10 ? 2 : 1)}x`; }
function multipleUi(v){ if(v == null || v === '') return 'N/A'; if(v === Infinity) return '\u9ad8\u590d\u7528'; return multiple(v); }
function cacheRingHtml(st, extra = ''){ const hit = cacheHitRate(st); const pct = Math.max(0, Math.min(100, Number.isFinite(hit) ? hit : 0)); return `<div class="cache-ring ${esc(extra)}" style="--hit:${pct}%"><b>${cacheHitText(st)}</b><small>${TXT.cacheHitRate}</small></div>`; }
function cachePillHtml(st){ const hit = cacheHitRate(st); const hitW = Math.max(0, Math.min(100, Number.isFinite(hit) ? hit : 0)); const tone = hit == null ? 'cold' : hit >= 60 ? 'hot' : hit >= 25 ? 'warm' : 'cold'; return `<span class="cache-pill ${tone}" style="--hit:${hitW}%" title="${TXT.cacheHitBasis} ${cacheHitBasis(st)}"><b>${cacheHitText(st)}</b><em>${cacheHitBasis(st)}</em><i></i></span>`; }
function cacheHealth(st){ const hit = cacheHitRate(st); if(hit == null) return { tone: 'cold', label: 'N/A', hint: TXT.cacheLowHint }; if(hit >= 60) return { tone: 'hot', label: '\u9ad8\u590d\u7528', hint: TXT.cacheHighHint }; if(hit >= 25) return { tone: 'warm', label: '\u6709\u590d\u7528', hint: TXT.cacheMidHint }; return { tone: 'cold', label: '\u5f85\u63d0\u5347', hint: TXT.cacheLowHint }; }
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
