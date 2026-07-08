function sourceName(r){ const k = sourceKey(r); if(k === 'cli') return TXT.cli; if(k === 'desktop') return TXT.desktop; if(k === 'all') return TXT.allSource; return r.sourceLabel || r.label || r.source || TXT.unknown; }

function sourceKey(r){ const raw = String(r.source || r.id || '').toLowerCase(); if(raw.includes('cli')) return 'cli'; if(raw.includes('desktop') || raw.includes('codearts-data')) return 'desktop'; const label = String(r.sourceLabel || r.label || '').toLowerCase(); if(label === TXT.desktop.toLowerCase()) return 'desktop'; if(label === 'cli') return 'cli'; return raw || label || 'unknown'; }

function sourceColor(k){ if(k === 'cli') return 'linear-gradient(135deg,#111827,#64748b)'; if(k === 'desktop') return 'linear-gradient(135deg,#1687f5,#8b5cf6)'; if(k === 'all') return 'linear-gradient(135deg,#ff8a1d,#1687f5)'; return 'linear-gradient(135deg,#64748b,#94a3b8)'; }

function sourceIcon(k){ if(k === 'desktop') return 'D'; if(k === 'cli') return '&gt;_'; if(k === 'all') return '&#9638;'; return '&#9679;'; }

function rgba(hex, alpha){ const raw = String(hex || '').replace('#', ''); if(raw.length !== 6) return `rgba(22,135,245,${alpha})`; const n = parseInt(raw, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; }

function sourceDisplayLabel(k, fallback){ if(k === 'desktop') return TXT.desktop; if(k === 'cli') return TXT.cli; if(k === 'all') return TXT.allSource; return fallback || k || TXT.unknown; }

function memoForSnapshot(s){
  if(!s || typeof s !== 'object') return { filters: new Map(), sums: new WeakMap(), groups: new Map(), hourly: new Map() };
  let memo = analyticsMemo.get(s);
  if(!memo){ memo = { filters: new Map(), sums: new WeakMap(), groups: new Map(), hourly: new Map(), sourceOptions: null, modelOptions: null }; analyticsMemo.set(s, memo); }
  return memo;
}

function filterCacheKey(range, source, model, since, until){ return `${range || 'all'}|${source || 'all'}|${model || 'all'}|${since || 0}|${until || 0}|${customDateStart || 0}|${customDateEnd || 0}`; }

function sourceOptions(s){
  const memo = memoForSnapshot(s);
  if(memo.sourceOptions) return memo.sourceOptions;
  const set = new Map();
  for(const src of s.sources || []){ const k = sourceKey(src); if(k && k !== 'unknown') set.set(k, sourceDisplayLabel(k, src.label)); }
  for(const r of s.requestLog || []){ const k = sourceKey(r); if(k && k !== 'unknown') set.set(k, sourceDisplayLabel(k, r.sourceLabel || r.source)); }
  if(!set.has('desktop')) set.set('desktop', TXT.desktop);
  if(!set.has('cli')) set.set('cli', TXT.cli);
  const order = { desktop: 0, cli: 1 };
  memo.sourceOptions = [...set.entries()].sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9) || a[1].localeCompare(b[1], 'zh-CN'));
  return memo.sourceOptions;
}

function sourceLabelFor(s, key){ if(key === 'all') return TXT.allSource; return sourceOptions(s).find((x) => x[0] === key)?.[1] || key || TXT.unknown; }

function modelOptions(s){
  const memo = memoForSnapshot(s);
  if(memo.modelOptions) return memo.modelOptions;
  memo.modelOptions = [...new Set((s.requestLog || []).map((r) => r.model).filter(Boolean))].sort();
  return memo.modelOptions;
}

function filterRows(s, opts = {}){
  const range = opts.range ?? rangeFilter;
  const source = opts.source ?? sourceFilter;
  const model = opts.model ?? modelFilter;
  const since = sinceForRange(s, range);
  const until = untilForRange(s, range);
  const memo = memoForSnapshot(s);
  const key = filterCacheKey(range, source, model, since, until);
  if(memo.filters.has(key)) return memo.filters.get(key);
  const rows = (s.requestLog || []).filter((r) => {
    const time = Number(r.time || 0);
    if(since && time < since) return false;
    if(until && time > until) return false;
    if(source !== 'all' && sourceKey(r) !== source) return false;
    if(model !== 'all' && r.model !== model) return false;
    return true;
  });
  memo.filters.set(key, rows);
  if(memo.filters.size > 48) memo.filters.delete(memo.filters.keys().next().value);
  return rows;
}

function applyTableSearch(rows){ const q = analyticsQuery.trim().toLowerCase(); if(!q) return rows; return rows.filter((r) => `${r.sessionTitle || ''} ${r.sessionId || ''} ${r.provider || ''} ${r.model || ''} ${sourceName(r)}`.toLowerCase().includes(q)); }

function sumReq(rows){
  const globalMemo = memoForSnapshot(snapshot || {});
  if(rows && typeof rows === 'object' && globalMemo.sums.has(rows)) return globalMemo.sums.get(rows);
  const result = rows.reduce((a, r) => {
    a.total += r.total || 0;
    a.input += r.input || 0;
    a.output += r.output || 0;
    a.cacheRead += r.cacheRead || 0;
    a.cacheWrite += r.cacheWrite || 0;
    a.reasoning += r.reasoning || 0;
    a.requests += 1;
    if(!r.ok) a.errors += 1;
    if(Number.isFinite(r.latencyMs)) a.latencies.push(r.latencyMs);
    if(Number.isFinite(r.ttftMs)) a.ttfts.push(r.ttftMs);
    if(Number.isFinite(r.firstContentMs)) a.firstContents.push(r.firstContentMs);
    if(Number.isFinite(r.outputTokensPerSec)) a.speeds.push(r.outputTokensPerSec);
    return a;
  }, { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, requests: 0, errors: 0, latencies: [], ttfts: [], firstContents: [], speeds: [] });
  if(rows && typeof rows === 'object') globalMemo.sums.set(rows, result);
  return result;
}

function avg(arr){ return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

function groupBy(rows, fn){ const map = new Map(); for(const r of rows){ const k = fn(r) || 'unknown'; const arr = map.get(k) || []; arr.push(r); map.set(k, arr); } return [...map.entries()].map(([key, items]) => ({ key, items, stats: sumReq(items) })).sort((a, b) => b.stats.total - a.stats.total); }

function exactUsageFromSnapshot(s, key){ const u = s.usage || {}; if(key === 'today') return u.today || {}; if(key === 'window') return u.window || {}; if(key === 'week') return u.week || {}; return u.all || {}; }

function periodTotal(s, key){ if(sourceFilter === 'all' && modelFilter === 'all') return exactUsageFromSnapshot(s, key); const range = key === 'today' ? 'today' : key === 'window' ? '1d' : key === 'week' ? '7d' : 'all'; return sumReq(filterRows(s, { range })); }

function queueForRange(s){ if(!s.queue) return {}; if(rangeFilter === 'customTime') return s.queue.all || {}; if(rangeFilter === 'today') return s.queue.today || {}; if(rangeFilter === '1d') return s.queue.window || {}; if(rangeFilter === '7d') return s.queue.week || {}; return s.queue.all || {}; }

function selectHtml(kind, value, options, allLabel){ return `<div class="select select-${kind}"><select data-select="${kind}"><option value="all">${esc(allLabel)}</option>${options.map(([v, l]) => `<option value="${esc(v)}" ${value === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`; }

function sourceSelectHtml(s){ const opts = sourceOptions(s); return `<div class="select select-source"><select data-select="source"><option value="all" ${sourceFilter === 'all' ? 'selected' : ''}>${TXT.allSource}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${sourceFilter === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`; }

function sourceChips(s){ const opts = [['all', TXT.all], ...sourceOptions(s)]; return `<div class="source-switch" role="group" aria-label="${TXT.source}">${opts.map(([k, l]) => `<button class="source-switch-btn ${sourceFilter === k ? 'active' : ''}" data-source="${esc(k)}" aria-pressed="${sourceFilter === k ? 'true' : 'false'}" title="${esc(k === 'all' ? TXT.allSource : l)}"><span class="source-icon" style="background:${sourceColor(k)}">${sourceIcon(k)}</span><span>${esc(l)}</span></button>`).join('')}</div>`; }

function refreshSelectHtml(){ const values = [['5', '5s'], ['15', '15s'], ['30', '30s'], ['60', '60s']]; return `<div class="select select-refresh"><span class="refresh-glyph">&#8635;</span><select data-select="refresh">${values.map(([v, l]) => `<option value="${v}" ${refreshEvery === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`; }
