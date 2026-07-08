function sourceName(r){ const k = sourceKey(r); if(k === 'cli') return TXT.cli; if(k === 'desktop') return TXT.desktop; if(k === 'all') return TXT.allSource; return r.sourceLabel || r.label || r.source || TXT.unknown; }
function sourceKey(r){ const raw = String(r.source || r.id || '').toLowerCase(); if(raw.includes('cli')) return 'cli'; if(raw.includes('desktop') || raw.includes('codearts-data')) return 'desktop'; const label = String(r.sourceLabel || r.label || '').toLowerCase(); if(label === TXT.desktop.toLowerCase()) return 'desktop'; if(label === 'cli') return 'cli'; return raw || label || 'unknown'; }
function sourceColor(k){ if(k === 'cli') return 'linear-gradient(135deg,#111827,#64748b)'; if(k === 'desktop') return 'linear-gradient(135deg,#1687f5,#8b5cf6)'; if(k === 'all') return 'linear-gradient(135deg,#ff8a1d,#1687f5)'; return 'linear-gradient(135deg,#64748b,#94a3b8)'; }
function sourceIcon(k){ if(k === 'desktop') return 'D'; if(k === 'cli') return '&gt;_'; if(k === 'all') return '&#9638;'; return '&#9679;'; }
function rgba(hex, alpha){ const raw = String(hex || '').replace('#', ''); if(raw.length !== 6) return `rgba(22,135,245,${alpha})`; const n = parseInt(raw, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; }
function sourceDisplayLabel(k, fallback){ if(k === 'desktop') return TXT.desktop; if(k === 'cli') return TXT.cli; if(k === 'all') return TXT.allSource; return fallback || k || TXT.unknown; }
const analyticsMemo = new WeakMap();
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
function periodCard(label, stat, tone){ return `<div class="period-card ${tone}"><div class="period-label">${esc(label)}</div><div class="period-value">${compact(stat.total || 0)}</div><div class="period-sub">${n(stat.messages || stat.requests || 0)} ${TXT.requests}</div></div>`; }
function renderPeriodGrid(s){ return `<div class="period-grid">${periodCard(TXT.todayToken, periodTotal(s, 'today'), 'blue')}${periodCard(TXT.windowToken, periodTotal(s, 'window'), 'violet')}${periodCard(TXT.weekToken, periodTotal(s, 'week'), 'green')}${periodCard(TXT.allToken, periodTotal(s, 'all'), 'slate')}</div>`; }
function mini(label, value, color){ return `<div class="mini"><div class="label"><span class="dot" style="background:${color}"></span>${esc(label)}</div><div class="value">${esc(value)}</div></div>`; }
function usageProgress(st){ const total = Math.max(1, st.total || 0); const seg = (value, color) => `<i style="--w:${Math.max(0, Math.min(100, (Number(value || 0) / total) * 100))}%; --c:${color}"></i>`; return `<div class="usage-progress"><div class="progress-meta"><span>${TXT.tokenBreakdown} &#183; ${TXT.cacheHitRate} ${cacheHitText(st)} &#183; ${TXT.cacheHitBasis} ${cacheHitBasis(st)}</span><b>${compact(st.total)}</b></div><div class="progress-track">${seg(st.input, COLORS.input)}${seg(st.output, COLORS.output)}${seg(st.cacheWrite, COLORS.cacheWrite)}${seg(st.cacheRead, COLORS.cacheRead)}</div></div>`; }
function sourceSplitMini(s){
  const opts = sourceOptions(s).filter(([k]) => k === 'desktop' || k === 'cli');
  if(!opts.length) return '';
  const allRows = filterRows(s, { source: 'all' });
  const all = Math.max(1, sumReq(allRows).total || 0);
  const cards = opts.map(([k, label]) => {
    const rows = filterRows(s, { source: k });
    const st = sumReq(rows);
    const pct = Math.max(0, Math.min(100, ((st.total || 0) / all) * 100));
    const active = sourceFilter === k ? 'active' : '';
    return `<button class="cc-source-mini ${active}" data-source="${esc(k)}" aria-pressed="${sourceFilter === k ? 'true' : 'false'}"><span class="source-icon" style="background:${sourceColor(k)}">${sourceIcon(k)}</span><span><b>${esc(label)}</b><em>${n(st.requests)} ${TXT.requests} / ${sourceSessions(s, k)} ${TXT.session} / ${TXT.cacheHitRate} ${cacheHitText(st)}</em></span><strong>${compact(st.total)}</strong><i style="--w:${pct}%"></i></button>`;
  }).join('');
  return `<div class="cc-source-split"><div class="cc-source-split-head"><span>${TXT.sourceCompare}</span><em>${TXT.sourceCompareHint}</em></div><div class="cc-source-split-grid">${cards}</div></div>`;
}
function compactHourlyBuckets(s){
  const memo = memoForSnapshot(s);
  const cacheKey = `${sourceFilter}|${modelFilter}|${Number(s?.timestamp || 0)}|${rangeFilter}|${customDateStart}|${customDateEnd}`;
  if(memo.hourly.has(cacheKey)) return memo.hourly.get(cacheKey);
  const now = Number(s?.timestamp || Date.now());
  const bucketMs = 3600000;
  const end = Math.floor(now / bucketMs) * bucketMs;
  const start = end - 23 * bucketMs;
  const buckets = Array.from({ length: 24 }, (_, i) => ({ start: start + i * bucketMs, end: start + (i + 1) * bucketMs, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, ttfts: [], waits: [] }));
  const indexFor = (time) => Math.floor((Math.floor((time || 0) / bucketMs) * bucketMs - start) / bucketMs);
  for(const r of filterRows(s, { range: '1d' })){
    const index = indexFor(r.time || 0);
    if(index < 0 || index >= buckets.length) continue;
    const b = buckets[index];
    b.total += r.total || 0;
    b.input += r.input || 0;
    b.output += r.output || 0;
    b.cacheRead += r.cacheRead || 0;
    b.cacheWrite += r.cacheWrite || 0;
    b.requests += 1;
    if(Number.isFinite(r.ttftMs)) b.ttfts.push(r.ttftMs);
    if(Number.isFinite(r.latencyMs)) b.waits.push(r.latencyMs);
  }
  for(const b of buckets){ b.ttftMs = avg(b.ttfts) || 0; b.waitMs = avg(b.waits) || 0; b.cacheHitRate = cacheHitRate(b) || 0; delete b.ttfts; delete b.waits; }
  memo.hourly.set(cacheKey, buckets);
  if(memo.hourly.size > 12) memo.hourly.delete(memo.hourly.keys().next().value);
  return buckets;
}
function hourLabel(ts){ return new Date(Number(ts) || 0).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function shortDuration(msValue){
  const minutes = Math.max(0, Math.round((Number(msValue) || 0) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if(h && m) return `${h}h ${m}m`;
  if(h) return `${h}h`;
  return `${m}m`;
}
function idleWindowsFromBuckets(buckets, now = Date.now()){
  const windows = [];
  let current = null;
  for(const b of buckets || []){
    const end = Math.min(Number(b.end || (b.start + 3600000)), now);
    if(end <= b.start) continue;
    const idle = Number(b.requests || 0) === 0;
    if(idle){
      if(!current) current = { start: b.start, end, buckets: 0 };
      current.end = end;
      current.buckets += 1;
    } else if(current){
      windows.push(current);
      current = null;
    }
  }
  if(current) windows.push(current);
  return windows;
}
function activeWindowsFromBuckets(buckets, now = Date.now()){
  const windows = [];
  let current = null;
  for(const b of buckets || []){
    const end = Math.min(Number(b.end || (b.start + 3600000)), now);
    if(end <= b.start) continue;
    const active = Number(b.requests || 0) > 0;
    if(active){
      if(!current) current = { start: b.start, end, buckets: 0, requests: 0, total: 0 };
      current.end = end;
      current.buckets += 1;
      current.requests += Number(b.requests || 0);
      current.total += Number(b.total || 0);
    } else if(current){
      windows.push(current);
      current = null;
    }
  }
  if(current) windows.push(current);
  return windows;
}
function idleSummary(s){
  const buckets = compactHourlyBuckets(s);
  const now = Number(s?.timestamp || Date.now());
  const windows = idleWindowsFromBuckets(buckets, now);
  const idleMs = windows.reduce((sum, w) => sum + Math.max(0, w.end - w.start), 0);
  const currentIdle = windows.some((w) => now >= w.start && now <= w.end + 1000);
  const longest = windows.reduce((best, w) => ((w.end - w.start) > ((best?.end || 0) - (best?.start || 0)) ? w : best), null);
  const activeWindows = activeWindowsFromBuckets(buckets, now);
  const activeMs = activeWindows.reduce((sum, w) => sum + Math.max(0, w.end - w.start), 0);
  const currentActive = activeWindows.some((w) => now >= w.start && now <= w.end + 1000);
  return { buckets, windows, idleMs, currentIdle, longest, activeWindows, activeMs, currentActive };
}
function idleWindowLabel(w){ return `${hourLabel(w.start)} \u81f3 ${hourLabel(w.end)}`; }
function compactBars(s){
  const data = compactHourlyBuckets(s);
  const max = Math.max(1, ...data.map((b) => b.total || 0));
  return `<div class="compact-bars" aria-label="24h token">${data.map((b) => { const label = hourLabel(b.start); const h = Math.max(2, Math.round(((b.total || 0) / max) * 48)); const idle = Number(b.requests || 0) === 0; const title = idle ? `${label} &#183; ${TXT.idleHours}` : `${label} &#183; ${n(b.total || 0)} token / ${n(b.requests || 0)} ${TXT.requests}`; return `<span class="${idle ? 'idle' : 'active'}" style="height:${idle ? 6 : h}px" title="${esc(title)}"></span>`; }).join('')}</div>`;
}
function idleTimelineHtml(s, compact = false){
  const info = idleSummary(s);
  const list = info.windows.slice(-6);
  const label = info.windows.length ? list.map(idleWindowLabel).join(' / ') : TXT.noIdle;
  const longest = info.longest ? `${idleWindowLabel(info.longest)} &#183; ${shortDuration(info.longest.end - info.longest.start)}` : TXT.noIdle;
  const max = Math.max(1, ...info.buckets.map((x) => x.total || 0));
  return `<div class="idle-card ${compact ? 'compact-idle' : ''}"><div class="idle-head"><span>${TXT.idleWindow}</span><b>${shortDuration(info.idleMs)}</b></div><div class="idle-rail">${info.buckets.map((b) => { const idle = Number(b.requests || 0) === 0; const pct = Math.max(4, Math.min(100, ((b.total || 0) / max) * 100)); const title = `${hourLabel(b.start)} &#183; ${idle ? TXT.idleHours : `${n(b.requests || 0)} ${TXT.requests}`}`; return `<i class="${idle ? 'idle' : 'busy'}" style="--w:${pct}%" title="${esc(title)}"></i>`; }).join('')}</div><div class="idle-meta"><span>${info.currentIdle ? TXT.idleNow : TXT.activeHour}</span><em title="${esc(label)}">${esc(label)}</em></div><small>${TXT.idleHint} &#183; ${esc(longest)}</small></div>`;
}
function renderAgentRhythm(s){
  const info = idleSummary(s);
  const buckets = info.buckets || [];
  if(!buckets.length) return '';
  const max = Math.max(1, ...buckets.map((b) => b.total || 0));
  const totalMs = info.idleMs + info.activeMs;
  const activeRatio = totalMs > 0 ? (info.activeMs / totalMs) * 100 : 0;
  const longestIdle = info.longest ? `${idleWindowLabel(info.longest)} / ${shortDuration(info.longest.end - info.longest.start)}` : TXT.noIdle;
  const recommended = info.longest ? idleWindowLabel(info.longest) : TXT.noIdle;
  const busyList = [...info.activeWindows].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 3);
  const idleList = info.windows.slice(-4);
  const busyHtml = busyList.length ? busyList.map((w) => `<li><b>${esc(idleWindowLabel(w))}</b><span>${n(w.requests || 0)} ${TXT.requests} / ${compact(w.total || 0)} token</span></li>`).join('') : `<li class="empty"><b>${TXT.noBusy}</b><span>${TXT.liveAfterReply}</span></li>`;
  const idleHtml = idleList.length ? idleList.map((w) => `<li><b>${esc(idleWindowLabel(w))}</b><span>${shortDuration(w.end - w.start)}</span></li>`).join('') : `<li class="empty"><b>${TXT.noIdle}</b><span>${TXT.idleHint}</span></li>`;
  const rail = buckets.map((b) => {
    const idle = Number(b.requests || 0) === 0;
    const load = Math.max(4, Math.min(100, ((b.total || 0) / max) * 100));
    const label = hourLabel(b.start);
    const title = idle ? `${label} / ${TXT.idleHours}` : `${label} / ${n(b.requests || 0)} ${TXT.requests} / ${compact(b.total || 0)} token`;
    return `<i class="${idle ? 'idle' : 'busy'}" style="--load:${load}%" title="${esc(title)}"><span>${esc(label.slice(0, 2))}</span></i>`;
  }).join('');
  return `<section class="agent-rhythm-card"><div class="section-head"><div><div class="section-title">${TXT.agentRhythm}</div><p>${TXT.agentRhythmHint}</p></div><span>${info.currentIdle ? TXT.rhythmNowIdle : TXT.rhythmNowBusy}</span></div><div class="agent-rhythm-body"><div class="rhythm-hero"><div><span>${TXT.idleTotal}</span><strong>${shortDuration(info.idleMs)}</strong><em>${TXT.recommendedWindow}: ${esc(recommended)}</em></div><div><span>${TXT.activeTotal}</span><strong>${shortDuration(info.activeMs)}</strong><em>${TXT.activeRatio} ${percent(activeRatio)}</em></div><div><span>${TXT.longestIdle}</span><strong>${info.longest ? shortDuration(info.longest.end - info.longest.start) : 'N/A'}</strong><em>${esc(longestIdle)}</em></div></div><div class="agent-rhythm-rail" aria-label="${TXT.agentRhythm}">${rail}</div><div class="agent-rhythm-lists"><div><b>${TXT.idleWindows}</b><ul>${idleHtml}</ul></div><div><b>${TXT.busyWindows}</b><ul>${busyHtml}</ul></div></div></div></section>`;
}
function compactStat(label, value, sub, color){ return `<div class="compact-stat"><div><span class="dot" style="background:${color}"></span>${esc(label)}</div><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`; }
function compactModelRows(rows, limit = 5){
  const groups = groupBy(rows, (r) => r.model).slice(0, limit);
  const max = Math.max(1, ...groups.map((g) => g.stats.total || 0));
  if(!groups.length) return `<div class="compact-empty">${TXT.emptyHint}</div>`;
  return `<div class="compact-list">${groups.map((g) => `<div class="compact-row"><div><b>${esc(shortModel(g.key))}</b><span>${n(g.stats.requests)} ${TXT.requests} 閻?${TXT.ttft} ${ms(avg(g.stats.ttfts))}</span></div><strong>${compact(g.stats.total)}</strong><i style="--w:${Math.max(4, Math.min(100, ((g.stats.total || 0) / max) * 100))}%"></i></div>`).join('')}</div>`;
}
function compactSessionRows(s){
  const list = sortSessions((s.sessions || []).filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && sessionStatusMatches(item))).slice(0, 5);
  if(!list.length) return `<div class="compact-empty">${TXT.emptyHint}</div>`;
  return `<div class="compact-list compact-sessions">${list.map((item) => { const u = item.usage || {}; const tags = (metaForSession(item).tags || []).slice(0, 2).join(' 閻?'); return `<button class="compact-row compact-session-row" data-table="sessions" data-session-select="${esc(sessionKeyFor(item))}"><div><b>${esc(item.title || '(untitled)')}</b><span>${esc(sourceName(item))} 閻?${n(u.userTurns || 0)} ${TXT.turns}${tags ? ` 閻?${esc(tags)}` : ''}</span></div><strong>${compact(u.total || 0)}</strong><i style="--w:${Math.max(3, Math.min(100, ((u.total || 0) / Math.max(1, list[0]?.usage?.total || 1)) * 100))}%"></i></button>`; }).join('')}</div>`;
}
function compactSourcePill(s){
  const st = sumReq(filterRows(s));
  const source = sourceFilter === 'all' ? TXT.allSource : sourceLabelFor(s, sourceFilter);
  const model = modelFilter === 'all' ? TXT.allModel : shortModel(modelFilter);
  return `<div class="compact-filter-pill"><span>${rangeLabel()}</span><span>${esc(source)}</span><span>${esc(model)}</span><b>${n(st.requests)} ${TXT.requests}</b><b>${TXT.cacheHitRate} ${cacheHitText(st)}</b></div>`;
}
function compactPaneTabs(){
  const panes = [['overview', '\u6982\u89c8'], ['sources', '\u6765\u6e90'], ['sessions', '\u4f1a\u8bdd']];
  return `<div class="compact-pane-tabs" role="group" aria-label="\u5361\u7247\u89c6\u56fe">${panes.map(([key, label]) => `<button data-compact-pane="${key}" class="${compactPane === key ? 'active' : ''}" aria-pressed="${compactPane === key ? 'true' : 'false'}">${label}</button>`).join('')}</div>`;
}
function compactControlsHtml(){
  return `<div class="compact-controls compact-controls-simple"><button data-compact-pin="1" class="${compactPinned ? 'active' : ''}" aria-pressed="${compactPinned ? 'true' : 'false'}">${compactPinned ? '\u5df2\u56fa\u5b9a' : '\u56fa\u5b9a\u5728\u6700\u524d'}</button><span>${compactPinned ? '\u7a97\u53e3\u5c06\u4fdd\u6301\u524d\u7f6e' : '\u9700\u8981\u76ef\u76d8\u65f6\u6253\u5f00'}</span></div>`;
}
function renderCompactMenu(s, rows){
  const st = sumReq(rows);
  const q = queueForRange(s);
  const todayStat = periodTotal(s, 'today');
  const windowStat = periodTotal(s, 'window');
  const modelRows = rows.length ? rows : filterRows(s, { range: '1d' });
  const modelScope = rows.length ? rangeLabel() : '24h';
  const hourly = compactHourlyBuckets(s);
  const peak = hourly.reduce((best, b) => (b.total || 0) > (best.total || 0) ? b : best, hourly[0] || { total: 0, start: Date.now() });
  const peakLabel = new Date(peak.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const selectedSource = sourceLabelFor(s, sourceFilter);
  const hero = `<div class="compact-hero"><div><span>${TXT.realTokens}</span><strong>${n(st.total)}</strong><em>${compact(st.total)} &#183; ${sourceFilter === 'all' ? TXT.all : esc(selectedSource)}</em></div>${cacheRingHtml(st, 'compact-ring')}</div><div class="compact-progress"><i style="--w:${Math.max(0, Math.min(100, ((st.input || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.input}"></i><i style="--w:${Math.max(0, Math.min(100, ((st.output || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.output}"></i><i style="--w:${Math.max(0, Math.min(100, ((st.cacheWrite || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.cacheWrite}"></i><i style="--w:${Math.max(0, Math.min(100, ((st.cacheRead || 0) / Math.max(1, st.total || 1)) * 100))}%; --c:${COLORS.cacheRead}"></i></div>`;
  const overviewPane = `${hero}<div class="compact-stat-grid">${compactStat(TXT.todayToken, compact(todayStat.total || 0), `${n(todayStat.requests || todayStat.messages || 0)} ${TXT.requests}`, COLORS.input)}${compactStat(TXT.windowToken, compact(windowStat.total || 0), `${n(windowStat.requests || windowStat.messages || 0)} ${TXT.requests}`, COLORS.cacheRead)}${compactStat(TXT.cacheEfficiency, cacheHitText(st), `${TXT.cacheHitBasis} ${cacheHitBasis(st)}`, COLORS.purple)}${compactStat(TXT.ttft, ms(avg(st.ttfts)), `${TXT.avg} TTFT`, COLORS.wait)}${compactStat(TXT.wait, ms(avg(st.latencies)), `${TXT.queue} ${q.samples ? ms(q.avg) : 'N/A'}`, COLORS.queue)}${compactStat(TXT.peakHour, `${peakLabel} &#183; ${compact(peak.total)}`, '24h', COLORS.total)}</div><div class="compact-section"><div class="compact-section-head"><b>24h token</b><span>${TXT.hoverHint}</span></div>${compactBars(s)}</div><div class="compact-section"><div class="compact-section-head"><b>${TXT.modelStats}</b><span>${esc(modelScope)} &#183; ${n(groupBy(modelRows, (r) => r.model).length)} ${TXT.model}</span></div>${compactModelRows(modelRows, 3)}</div>`;
  const sourcePane = `<div class="compact-panel-head"><b>${TXT.sourceCompare}</b><span>${TXT.currentFilter}</span></div>${sourceSplitMini(s)}<div class="compact-section"><div class="compact-section-head"><b>${TXT.cacheInsights}</b><span>${TXT.cacheHitRate} ${cacheHitText(st)}</span></div>${cacheEfficiencyPanel(st, 'summary-cache')}</div>`;
  const sessionPane = `<div class="compact-section side-sessions"><div class="compact-section-head"><b>${TXT.recentSessions}</b><span>${TXT.sessionManage}</span></div>${compactSessionRows(s)}</div><div class="compact-panel-actions"><button data-table="requests">${TXT.reqLog}</button><button data-table="sessions">${TXT.sessionManage}</button><button data-table="models">${TXT.modelStats}</button></div><div class="compact-note">${TXT.liveAfterReply}</div>`;
  const panes = { overview: overviewPane, sources: sourcePane, sessions: sessionPane };
  return `<div class="compact-stage single"><section class="codex-compact-card compact-single-card"><div class="compact-provider"><div class="logo compact-logo"><img src="../assets/codearts-logo.png" /></div><div><h2>${TXT.compactTitle}</h2><p>${TXT.compactHint}</p></div><span>${TXT.realtime}</span></div>${compactSourcePill(s)}${compactControlsHtml()}${compactPaneTabs()}<div class="compact-pane">${panes[compactPane] || panes.overview}</div></section></div>`;
}

function sourceSessions(s, key){ return (s.sessions || []).filter((item) => key === 'all' || sourceKey(item) === key).length; }
function sourceBars(rows, s){ const data = bucketRows(rows, s).slice(-24); const max = Math.max(1, ...data.map((b) => b.total || 0)); return `<div class="source-bars">${data.map((b) => { const h = Math.max(2, Math.round(((b.total || 0) / max) * 34)); const d = new Date(b.start); const label = isDayRange() ? d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); return `<span style="height:${h}px" title="${esc(label)} \u00b7 ${n(b.total || 0)} token"></span>`; }).join('')}</div>`; }
function sourceFacts(st, sessions){ return `<div class="source-facts"><span>${n(st.requests)} ${TXT.requests}</span><span>${sessions} ${TXT.session}</span><span>${TXT.cacheHitRate} ${cacheHitText(st)}</span><span>${TXT.cacheRead} ${compact(st.cacheRead || 0)}</span><span>${TXT.wait} ${ms(avg(st.latencies))}</span></div>`; }
function usageTotalTile(label, value, tone, sub = ''){
  return `<div class="usage-total-tile ${tone || ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
}
function renderUsageTotalBoard(st, selectedSource, selectedModel){
  const hit = cacheHitRate(st);
  const hitW = Math.max(0, Math.min(100, Number.isFinite(hit) ? hit : 0));
  const health = cacheHealth(st);
  const reuse = multipleUi(cacheReuseValue(st));
  const total = Math.max(1, Number(st.total || 0));
  const pct = (value) => percent((Number(value || 0) / total) * 100);
  return `<div class="usage-total-board cache-${health.tone}" style="--cache-hit:${hitW}%"><div class="usage-total-hero"><div class="usage-total-main"><div class="usage-total-icon" aria-hidden="true"><span></span></div><div><div class="usage-total-label">${TXT.realTokens}</div><div class="usage-total-value">${n(st.total)}<span>&#8776; ${compact(st.total)}</span></div></div></div><div class="usage-total-request"><span>\u603b\u8bf7\u6c42\u6570</span><strong>${n(st.requests)}</strong><em>${rangeLabel()} / ${esc(selectedSource)} / ${esc(selectedModel)}</em><i class="usage-total-request-spark" aria-hidden="true"><small></small><small></small><small></small><small></small></i></div></div><div class="usage-total-strip">${usageTotalTile('\u65b0\u589e\u8f93\u5165', compact(st.input || 0), 'input', pct(st.input))}${usageTotalTile(TXT.output, compact(st.output || 0), 'output', pct(st.output))}${usageTotalTile('\u521b\u5efa', compact(st.cacheWrite || 0), 'create', pct(st.cacheWrite))}${usageTotalTile('\u547d\u4e2d', compact(st.cacheRead || 0), 'hit', pct(st.cacheRead))}<div class="usage-total-tile usage-total-cache"><div><span>${TXT.cacheHitRate}</span><b>${cacheHitText(st)}</b></div><i><em></em></i><small>${TXT.cacheHitBasis} ${cacheHitBasis(st)} &#183; ${health.label}${reuse !== 'N/A' ? ` &#183; ${reuse}` : ''}</small></div></div></div>`;
}
function renderSummary(rows, s){
  const st = sumReq(rows);
  const selectedSource = sourceLabelFor(s, sourceFilter);
  const selectedModel = modelFilter === 'all' ? TXT.allModel : shortModel(modelFilter);
  return `<section class="summary-card usage-summary cc-usage-summary">${renderUsageTotalBoard(st, selectedSource, selectedModel)}</section>`;
}
function renderUsageDetails(rows, s){
  const st = sumReq(rows);
  const q = queueForRange(s);
  const status = st.errors ? `${n(st.errors)} error` : '200';
  const selectedSource = sourceLabelFor(s, sourceFilter);
  const selectedModel = modelFilter === 'all' ? TXT.allModel : shortModel(modelFilter);
  return `<section class="usage-detail-stack usage-detail-section"><div class="summary-top usage-detail-head"><div class="filter-note"><b>${TXT.currentFilter}</b><span>${rangeLabel()} / ${esc(selectedSource)} / ${esc(selectedModel)}</span><em>${TXT.liveAfterReply}</em></div></div><div class="summary-kpi-row cc-kpi-row">${mini(TXT.input, compact(st.input), COLORS.input)}${mini(TXT.output, compact(st.output), COLORS.output)}${mini(TXT.cacheWrite, compact(st.cacheWrite), COLORS.cacheWrite)}${mini(TXT.cacheRead, compact(st.cacheRead), COLORS.cacheRead)}${mini(TXT.cacheHitRate, cacheHitText(st), COLORS.purple)}</div>${cacheEfficiencyPanel(st, 'summary-cache')}${idleTimelineHtml(s)}${usageProgress(st)}${sourceSplitMini(s)}${renderPeriodGrid(s)}<div class="mini-grid perf-grid">${mini(TXT.requests, n(st.requests), COLORS.total)}${mini(TXT.ttft, ms(avg(st.ttfts)), COLORS.cacheRead)}${mini(TXT.firstContent, ms(avg(st.firstContents)), COLORS.wait)}${mini(TXT.wait, ms(avg(st.latencies)), COLORS.queue)}${mini(TXT.speed, rate(avg(st.speeds)), COLORS.output)}${mini(TXT.queue, q.samples ? ms(q.avg) : 'N/A', COLORS.queue)}${mini(TXT.status, status, st.errors ? COLORS.red : COLORS.green)}${mini(TXT.source, sourceFilter === 'all' ? TXT.all : selectedSource, COLORS.muted)}</div></section>`;
}
function renderAnalyticsAdvanced(rows, s){
  if(!analyticsAdvancedOpen){
    return `<section class="analytics-advanced-shell collapsed"><div><b>${TXT.advancedAnalytics}</b><span>${TXT.advancedAnalyticsHint}</span></div><button data-analytics-advanced-toggle="1">${TXT.showAdvanced}</button></section>`;
  }
  return `<section class="analytics-advanced-shell"><div class="analytics-advanced-head"><div><b>${TXT.advancedAnalytics}</b><span>${TXT.advancedAnalyticsHint}</span></div><button data-analytics-advanced-toggle="1">${TXT.hideAdvanced}</button></div>${renderUsageDetails(rows, s)}${renderSourceOverview(s)}${renderCacheInsights(rows, s)}</section>`;
}

function renderSourceOverview(s){ const base = filterRows(s, { source: 'all' }); const opts = [['all', TXT.allSource], ...sourceOptions(s)]; const unique = [...new Map(opts).entries()]; const cards = unique.map(([k, label]) => { const rows = k === 'all' ? base : base.filter((r) => sourceKey(r) === k); const st = sumReq(rows); const sessions = sourceSessions(s, k); const active = sourceFilter === k ? 'active' : ''; return `<button class="source-card ${active}" data-source="${esc(k)}" aria-pressed="${sourceFilter === k ? 'true' : 'false'}"><span class="source-mark" style="background:${sourceColor(k)}">${sourceIcon(k)}</span><span class="source-name">${esc(label)}</span><strong>${compact(st.total)}</strong><small>${rangeLabel()} token</small>${sourceBars(rows, s)}${sourceFacts(st, sessions)}</button>`; }).join(''); return `<section class="source-overview cc-source-overview"><div class="section-head"><div><div class="section-title">${TXT.sourceOverview}</div><p>${TXT.sourceHint}</p></div><span>${rangeLabel()}</span></div><div class="source-grid">${cards}</div></section>`; }
function cacheInsightAction(st){
  const hit = cacheHitRate(st);
  if(hit == null) return TXT.cacheActionNone;
  if(hit < 25) return TXT.cacheActionLow;
  if(hit < 60) return TXT.cacheActionMid;
  return TXT.cacheActionHigh;
}
function cacheOpportunityScore(st){
  const total = Number(st?.total || 0);
  const hit = cacheHitRate(st);
  const miss = hit == null ? .72 : Math.max(.08, (100 - hit) / 100);
  const inputWeight = Number(st?.input || 0) / Math.max(1, total);
  return Math.round(total * miss * (1 + Math.min(.65, inputWeight)));
}
function cacheInsightRow(item, maxScore){
  const st = item.stats || {};
  const health = cacheHealth(st);
  const hit = cacheHitRate(st);
  const score = cacheOpportunityScore(st);
  const scoreW = Math.max(5, Math.min(100, (score / Math.max(1, maxScore)) * 100));
  const hitW = Math.max(0, Math.min(100, hit || 0));
  const attrs = item.model ? `data-cache-model="${esc(item.model)}"` : item.source ? `data-source="${esc(item.source)}"` : item.project ? `data-cache-project="${esc(item.project)}"` : '';
  return `<button class="cache-insight-row ${health.tone}" ${attrs}><span class="cache-insight-main"><b>${esc(item.label)}</b><em>${n(st.requests || 0)} ${TXT.requests} / ${TXT.cacheHitRate} ${cacheHitText(st)} / ${health.label}</em></span><span class="cache-insight-metrics"><strong>${compact(st.total || 0)}</strong><small>${TXT.cacheReadShort} ${compact(st.cacheRead || 0)} / ${TXT.cacheCreateShort} ${compact(st.cacheWrite || 0)}</small></span><span class="cache-insight-score"><i style="--score:${scoreW}%; --hit:${hitW}%"></i><em>${TXT.cacheOpportunityScore} ${compact(score)}</em></span><span class="cache-insight-action">${esc(cacheInsightAction(st))}</span></button>`;
}
function projectRowsForCacheInsights(rows, s){
  const bySession = new Map((s.sessions || []).map((item) => [String(item.id || ''), item]));
  const map = new Map();
  for(const r of rows){
    const session = bySession.get(String(r.sessionId || ''));
    const project = session ? sessionProjectKey(session) : (r.directory ? String(r.directory) : '__none');
    const label = session ? sessionProjectName(session) : (r.directory ? String(r.directory).split(/[\\/]/).filter(Boolean).pop() : TXT.noProject);
    const bucket = map.get(project) || { key: project, label, rows: [] };
    bucket.rows.push(r);
    map.set(project, bucket);
  }
  return [...map.values()].map((x) => ({ project: x.key, label: x.label, stats: sumReq(x.rows) })).sort((a, b) => cacheOpportunityScore(b.stats) - cacheOpportunityScore(a.stats));
}
function renderCacheInsights(rows, s){
  const scoped = applyTableSearch(rows);
  const base = scoped.length ? scoped : rows;
  if(!base.length) return '';
  const modelItems = groupBy(base, (r) => r.model).map((g) => ({ model: g.key, label: shortModel(g.key), stats: g.stats })).sort((a, b) => cacheOpportunityScore(b.stats) - cacheOpportunityScore(a.stats)).slice(0, 4);
  const projectItems = projectRowsForCacheInsights(base, s).slice(0, 4);
  const sourceItems = groupBy(base, (r) => sourceKey(r)).map((g) => ({ source: g.key, label: sourceDisplayLabel(g.key), stats: g.stats })).sort((a, b) => cacheOpportunityScore(b.stats) - cacheOpportunityScore(a.stats)).slice(0, 3);
  const allItems = [...modelItems, ...projectItems, ...sourceItems];
  const maxScore = Math.max(1, ...allItems.map((x) => cacheOpportunityScore(x.stats || {})));
  const panel = (title, items) => `<div class="cache-insight-panel"><div class="cache-insight-panel-head"><b>${esc(title)}</b><span>${n(items.length)} ${TXT.rows}</span></div><div class="cache-insight-list">${items.length ? items.map((item) => cacheInsightRow(item, maxScore)).join('') : `<div class="compact-empty">${TXT.emptyHint}</div>`}</div></div>`;
  return `<section class="cache-insights"><div class="section-head"><div><div class="section-title">${TXT.cacheInsights}</div><p>${TXT.cacheInsightsHint}</p></div><span>${rangeLabel()}</span></div><div class="cache-insight-grid">${panel(TXT.cacheInsightModel, modelItems)}${panel(TXT.cacheInsightProject, projectItems)}${panel(TXT.cacheInsightSource, sourceItems)}</div></section>`;
}
