function compactHourlyBuckets(s){
  const memo = memoForSnapshot(s);
  const cacheKey = `${sourceFilter}|${modelFilter}|${analyticsProjectFilter}|${Number(s?.timestamp || 0)}|${rangeFilter}|${customDateStart}|${customDateEnd}`;
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
