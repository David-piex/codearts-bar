function bucketRows(rows, s){
  let since = sinceForRange(s);
  const until = untilForRange(s);
  const now = Number(until || s.timestamp || Date.now());
  if(rangeFilter === 'all'){
    const times = rows.map((r) => Number(r.time || 0)).filter((t) => validTimestamp(t, s));
    const first = times.length ? Math.min(...times) : now;
    since = Math.max(dayStart(first), now - 365 * 86400000);
  }
  const dayMode = isDayRange();
  const bucketMs = dayMode ? 86400000 : 3600000;
  const start = dayMode ? dayStart(since) : Math.floor(since / bucketMs) * bucketMs;
  const end = dayMode ? dayStart(now) + 86400000 : Math.ceil(now / bucketMs) * bucketMs;
  const buckets = [];
  const bucketMap = new Map();
  for(let t = start; t <= end; t += bucketMs){
    const b = { start: t, end: t + bucketMs, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, errors: 0, waitMs: 0, ttftMs: 0, firstContentMs: 0, queueMs: 0, speeds: [], latencies: [], ttfts: [], firstContents: [] };
    buckets.push(b);
    bucketMap.set(t, b);
  }
  const trendList = dayMode ? (s?.trends?.daily14d || []) : (s?.trends?.hourly24h || []);
  const useTrendTokens = Array.isArray(trendList) && trendList.length > 0;
  if(useTrendTokens){
    for(const item of trendList){
      const rawTime = Number(item.start || 0);
      if(!validTimestamp(rawTime, s)) continue;
      const t = dayMode ? dayStart(rawTime) : Math.floor(rawTime / bucketMs) * bucketMs;
      const b = bucketMap.get(t);
      if(!b) continue;
      b.total += item.total || 0;
      b.input += item.input || 0;
      b.output += item.output || 0;
      b.cacheRead += item.cacheRead || 0;
      b.cacheWrite += item.cacheWrite || 0;
      b.requests += item.requests || item.messages || 0;
      b.errors += item.errors || 0;
      if(Number.isFinite(item.latencyAvg)) b.latencies.push(item.latencyAvg);
    }
  }
  for(const r of rows){
    const rawTime = Number(r.time || 0);
    if(!validTimestamp(rawTime, s)) continue;
    const t = dayMode ? dayStart(rawTime) : Math.floor(rawTime / bucketMs) * bucketMs;
    const b = bucketMap.get(t);
    if(!b) continue;
    if(!useTrendTokens){
      b.total += r.total || 0;
      b.input += r.input || 0;
      b.output += r.output || 0;
      b.cacheRead += r.cacheRead || 0;
      b.cacheWrite += r.cacheWrite || 0;
      b.requests += 1;
      if(!r.ok) b.errors += 1;
    }
    if(Number.isFinite(r.latencyMs)) b.latencies.push(r.latencyMs);
    if(Number.isFinite(r.ttftMs)) b.ttfts.push(r.ttftMs);
    if(Number.isFinite(r.firstContentMs)) b.firstContents.push(r.firstContentMs);
    if(Number.isFinite(r.outputTokensPerSec)) b.speeds.push(r.outputTokensPerSec);
  }
  const qList = dayMode ? (s?.queue?.trends?.daily14d || []) : (s?.queue?.trends?.hourly24h || []);
  for(const q of qList){
    const t = Number(q.start || 0);
    const key = dayMode ? dayStart(t) : Math.floor(t / bucketMs) * bucketMs;
    const b = bucketMap.get(key);
    if(b) b.queueMs = Number(q.avgMs || q.queue || 0) || 0;
  }
  for(const b of buckets){
    b.waitMs = avg(b.latencies) || 0;
    b.ttftMs = avg(b.ttfts) || 0;
    b.firstContentMs = avg(b.firstContents) || 0;
    b.speed = avg(b.speeds) || 0;
    b.cacheHitRate = cacheHitRate(b) || 0;
    delete b.latencies; delete b.ttfts; delete b.firstContents; delete b.speeds;
  }
  return buckets;
}

function chartSeriesMainValue(cfg, values, activeValues){
  const relevant = activeValues.length ? activeValues : values;
  if(cfg.kind === 'token') return seriesLabel(cfg, values.reduce((sum, v) => sum + v, 0));
  return seriesLabel(cfg, avg(relevant) || 0);
}

function seriesLabel(cfg, value){ return cfg.kind === 'ms' ? ms(value) : cfg.kind === 'speed' ? rate(value) : cfg.kind === 'pct' ? percent(value) : n(value); }

function axisLabel(active, value){ if(active.length && active.every((cfg) => cfg.kind === 'ms')) return ms(value); if(active.length && active.every((cfg) => cfg.kind === 'pct')) return percent(value); return compact(value); }

function clamp(nv, min, max){ return Math.max(min, Math.min(max, nv)); }
