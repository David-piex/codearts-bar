function trendScopeKey(parts = {}){
  const bucketMs = Math.max(1, Number(parts.bucketMs || 3600000));
  const range = parts.range || {};
  const startRaw = Number(parts.start ?? range.start ?? 0) || 0;
  const endRaw = Number(parts.end ?? range.end ?? 0) || 0;
  const start = startRaw > 0 ? Math.floor(startRaw / bucketMs) * bucketMs : 0;
  const end = endRaw > 0 ? Math.ceil(endRaw / bucketMs) * bucketMs : 0;
  return `${parts.source || 'all'}|${parts.model || 'all'}|${bucketMs}|${start}|${end}`;
}
function currentTrendScopeKey(s, dayMode = isDayRange()){
  const bucketMs = dayMode ? 86400000 : 3600000;
  return trendScopeKey({
    source: sourceFilter,
    model: modelFilter,
    start: sinceForRange(s),
    end: untilForRange(s) || rangeMinute(Number(s?.timestamp || Date.now())),
    bucketMs,
  });
}
function partialTrendSnapshot(s){
  const requestCount = Array.isArray(s?.requestLog) ? s.requestLog.length : 0;
  const requestTotal = Number(s?.requestTotal || requestCount);
  return requestTotal > requestCount || s?.lightRefresh === true;
}
function trendListCanDriveChart(s, dayMode){
  const list = dayMode ? (s?.trends?.daily14d || []) : (s?.trends?.hourly24h || []);
  if(!Array.isArray(list) || !list.length) return false;
  const partialRows = partialTrendSnapshot(s);
  const scoped = s?.trendsScope || '';
  if(scoped) return scoped === currentTrendScopeKey(s, dayMode);
  if(!partialRows) return false;
  return sourceFilter === 'all' && modelFilter === 'all';
}
function chartTrendSignature(s, dayMode){
  const trendList = dayMode ? (s?.trends?.daily14d || []) : (s?.trends?.hourly24h || []);
  if(!Array.isArray(trendList) || !trendList.length) return 'none';
  const first = trendList[0] || {};
  const last = trendList[trendList.length - 1] || {};
  const sum = trendList.reduce((acc, item) => {
    acc.total += Number(item.total || 0);
    acc.input += Number(item.input || 0);
    acc.output += Number(item.output || 0);
    acc.cacheRead += Number(item.cacheRead || 0);
    acc.cacheWrite += Number(item.cacheWrite || 0);
    acc.requests += Number(item.requests || item.messages || 0);
    return acc;
  }, { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 });
  return `${trendList.length}:${Number(first.start || 0)}:${Number(last.start || 0)}:${sum.total}:${sum.input}:${sum.output}:${sum.cacheRead}:${sum.cacheWrite}:${sum.requests}:${s?.trendsSource || ''}:${s?.trendsScope || ''}`;
}
function rememberStableChartBuckets(scopeKey, buckets){
  if(!scopeKey || !Array.isArray(buckets) || !buckets.length || typeof chartStableBucketCache === 'undefined') return;
  chartStableBucketCache.set(scopeKey, buckets);
  if(chartStableBucketCache.size > 10) chartStableBucketCache.delete(chartStableBucketCache.keys().next().value);
}
function rowsSignature(rows){
  if(!Array.isArray(rows) || !rows.length) return '0';
  const first = rows[0] || {};
  const last = rows[rows.length - 1] || {};
  return `${rows.length}:${Number(first.time || 0)}:${Number(last.time || 0)}:${Number(first.total || 0)}:${Number(last.total || 0)}`;
}
function minValidTimestamp(list, reader, s){
  let min = Infinity;
  if(!Array.isArray(list) || !list.length) return min;
  for(const item of list){
    const t = Number(reader(item) || 0);
    if(validTimestamp(t, s) && t < min) min = t;
  }
  return min;
}
function bucketRows(rows, s){
  let since = sinceForRange(s);
  const until = untilForRange(s);
  const now = Number(until || rangeMinute(s.timestamp || Date.now()));
  const dayMode = isDayRange();
  const bucketMs = dayMode ? 86400000 : 3600000;
  const trendList = dayMode ? (s?.trends?.daily14d || []) : (s?.trends?.hourly24h || []);
  const useTrendTokens = trendListCanDriveChart(s, dayMode);
  const partialRows = partialTrendSnapshot(s);
  const scopeKey = currentTrendScopeKey(s, dayMode);
  if(rangeFilter === 'all'){
    let first = now;
    if(useTrendTokens && trendList.length){
      first = minValidTimestamp(trendList, (item) => item.start, s);
      if(!Number.isFinite(first)) first = now;
    } else {
      const minRowTime = minValidTimestamp(rows, (r) => r.time, s);
      first = Number.isFinite(minRowTime) ? minRowTime : now;
    }
    since = Math.max(dayStart(first), now - 365 * 86400000);
  }
  const cacheMemo = memoForSnapshot(s);
  const rangeBucketKey = `${Math.floor(since / bucketMs)}:${Math.ceil(now / bucketMs)}`;
  const cacheKey = `${rangeFilter}|${sourceFilter}|${modelFilter}|${customDateStart}|${customDateEnd}|${rangeBucketKey}|${dayMode ? 'day' : 'hour'}|${chartTrendSignature(s, dayMode)}|${rowsSignature(rows)}`;
  if(cacheMemo?.chartBuckets?.has(cacheKey)) return cacheMemo.chartBuckets.get(cacheKey);
  const start = dayMode ? dayStart(since) : Math.floor(since / bucketMs) * bucketMs;
  const end = dayMode ? dayStart(now) + 86400000 : Math.ceil(now / bucketMs) * bucketMs;
  const buckets = [];
  const bucketMap = new Map();
  for(let t = start; t <= end; t += bucketMs){
    const b = { start: t, end: t + bucketMs, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, errors: 0, waitMs: 0, ttftMs: 0, firstContentMs: 0, queueMs: 0, speeds: [], latencies: [], ttfts: [], firstContents: [] };
    buckets.push(b);
    bucketMap.set(t, b);
  }
  if(partialRows && !useTrendTokens){
    const stable = typeof chartStableBucketCache !== 'undefined' ? chartStableBucketCache.get(scopeKey) : null;
    if(Array.isArray(stable) && stable.length) return stable;
    if(cacheMemo){
      if(!cacheMemo.chartBuckets) cacheMemo.chartBuckets = new Map();
      cacheMemo.chartBuckets.set(cacheKey, buckets);
    }
    return buckets;
  }
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
  const tokenOnlyTrend = useTrendTokens && SERIES.every((cfg) => cfg.kind === 'token');
  if(!tokenOnlyTrend){
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
  rememberStableChartBuckets(scopeKey, buckets);
  if(cacheMemo){
    if(!cacheMemo.chartBuckets) cacheMemo.chartBuckets = new Map();
    cacheMemo.chartBuckets.set(cacheKey, buckets);
    if(cacheMemo.chartBuckets.size > 16) cacheMemo.chartBuckets.delete(cacheMemo.chartBuckets.keys().next().value);
  }
  return buckets;
}

function seriesLabel(cfg, value){ return cfg.kind === 'ms' ? ms(value) : cfg.kind === 'speed' ? rate(value) : cfg.kind === 'pct' ? percent(value) : n(value); }

function axisLabel(active, value){ if(active.length && active.every((cfg) => cfg.kind === 'ms')) return ms(value); if(active.length && active.every((cfg) => cfg.kind === 'pct')) return percent(value); return compact(value); }

function clamp(nv, min, max){ return Math.max(min, Math.min(max, nv)); }
