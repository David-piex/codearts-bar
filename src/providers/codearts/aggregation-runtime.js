'use strict';

const agg = require('../../core/aggregator');
const { listDataSources, sourceMatchesPayload } = require('./sources');
const { safeDbError } = require('./diagnostics');
const {
  aggregateCacheKey,
  getAggregateCache,
  setAggregateCache,
  annotateCacheHit,
} = require('./aggregate-cache');

const slowAggregateEvents = [];
let slowAggregateCount = 0;
let slowAggregateFailedCount = 0;
let slowAggregateMaxMs = 0;
const slowAggregateByLabel = new Map();
const slowAggregateByAdapter = new Map();

function aggregatePerfNow() {
  try { if (globalThis.performance && typeof globalThis.performance.now === 'function') return globalThis.performance.now(); }
  catch {}
  return Date.now();
}
function slowAggregateThresholdMs(payload = {}) {
  const value = payload.slowAggregateMs ?? process.env.CODEARTS_BAR_SLOW_AGGREGATE_MS ?? 300;
  const n = Number(value);
  return Number.isFinite(n) ? n : 300;
}
function aggregateScopeLabel(payload = {}) {
  const range = payload.range || {};
  const bits = [];
  if (payload.source && payload.source !== 'all') bits.push(`source=${payload.source}`);
  if (payload.model && payload.model !== 'all') bits.push(`model=${payload.model}`);
  if (payload.query) bits.push('query=1');
  if (range.start || range.end) bits.push(`range=${Number(range.start || 0)}-${Number(range.end || 0)}`);
  return bits.length ? bits.join(' ') : 'scope=all';
}
function maybeLogSlowAggregate(label, adapter, payload, elapsedMs, failed = false) {
  const threshold = slowAggregateThresholdMs(payload);
  if (threshold < 0 || elapsedMs < threshold) return;
  const ms = elapsedMs.toFixed(1);
  const state = failed ? 'failed ' : '';
  const scope = aggregateScopeLabel(payload);
  const event = {
    label,
    adapter,
    ms: Number(ms),
    thresholdMs: threshold,
    failed: Boolean(failed),
    scope,
    timestamp: Date.now(),
  };
  slowAggregateCount += 1;
  if (failed) slowAggregateFailedCount += 1;
  slowAggregateMaxMs = Math.max(slowAggregateMaxMs, event.ms);
  bumpSlowAggregateGroup(slowAggregateByLabel, label, event);
  bumpSlowAggregateGroup(slowAggregateByAdapter, adapter, event);
  slowAggregateEvents.unshift(event);
  slowAggregateEvents.splice(16);
  console.warn(`[codearts-bar] slow ${state}aggregate ${label} ${ms}ms adapter=${adapter} ${scope}`);
}
function bumpSlowAggregateGroup(map, key, event) {
  const safeKey = String(key || 'unknown');
  const prev = map.get(safeKey) || { count: 0, failed: 0, maxMs: 0, lastMs: 0 };
  prev.count += 1;
  if (event.failed) prev.failed += 1;
  prev.maxMs = Math.max(Number(prev.maxMs || 0), Number(event.ms || 0));
  prev.lastMs = Number(event.ms || 0);
  map.set(safeKey, prev);
}
function slowAggregateGroupStats(map) {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, {
    count: Number(value.count || 0),
    failed: Number(value.failed || 0),
    maxMs: Number(value.maxMs || 0),
    lastMs: Number(value.lastMs || 0),
  }]));
}
function slowAggregateStats() {
  const last = slowAggregateEvents[0] || null;
  return {
    count: slowAggregateCount,
    failed: slowAggregateFailedCount,
    maxMs: slowAggregateMaxMs,
    last,
    recent: slowAggregateEvents.slice(0, 8),
    byLabel: slowAggregateGroupStats(slowAggregateByLabel),
    byAdapter: slowAggregateGroupStats(slowAggregateByAdapter),
  };
}
function resetSlowAggregateStats() {
  slowAggregateEvents.length = 0;
  slowAggregateCount = 0;
  slowAggregateFailedCount = 0;
  slowAggregateMaxMs = 0;
  slowAggregateByLabel.clear();
  slowAggregateByAdapter.clear();
}
function attachAggregatePerf(result, label, adapter, elapsedMs) {
  if (result && typeof result === 'object') {
    result.perf = { ...(result.perf || {}), aggregate: { label, adapter, ms: Number(elapsedMs.toFixed(1)) } };
  }
  return result;
}
function timeAggregateSync(label, adapter, payload, fn) {
  const sources = sourceList(payload);
  const key = aggregateCacheKey(label, adapter, payload, sources);
  const cached = getAggregateCache(key);
  if (cached) return annotateCacheHit(attachAggregatePerf(cached, label, adapter, 0), true);
  const start = aggregatePerfNow();
  try {
    const result = fn(sources);
    const elapsed = aggregatePerfNow() - start;
    maybeLogSlowAggregate(label, adapter, payload, elapsed, false);
    return setAggregateCache(key, annotateCacheHit(attachAggregatePerf(result, label, adapter, elapsed), false), payload);
  } catch (error) {
    const elapsed = aggregatePerfNow() - start;
    maybeLogSlowAggregate(label, adapter, payload, elapsed, true);
    throw error;
  }
}
async function timeAggregateAsync(label, adapter, payload, fn) {
  const sources = sourceList(payload);
  const key = aggregateCacheKey(label, adapter, payload, sources);
  const cached = getAggregateCache(key);
  if (cached) return annotateCacheHit(attachAggregatePerf(cached, label, adapter, 0), true);
  const start = aggregatePerfNow();
  try {
    const result = await fn(sources);
    const elapsed = aggregatePerfNow() - start;
    maybeLogSlowAggregate(label, adapter, payload, elapsed, false);
    return setAggregateCache(key, annotateCacheHit(attachAggregatePerf(result, label, adapter, elapsed), false), payload);
  } catch (error) {
    const elapsed = aggregatePerfNow() - start;
    maybeLogSlowAggregate(label, adapter, payload, elapsed, true);
    throw error;
  }
}
function addTokenInto(target, value = {}) {
  target.total += Number(value.total || 0);
  target.input += Number(value.input || 0);
  target.output += Number(value.output || 0);
  target.reasoning += Number(value.reasoning || 0);
  target.cacheRead += Number(value.cacheRead || 0);
  target.cacheWrite += Number(value.cacheWrite || 0);
  target.messages += Number(value.messages || value.requests || 0);
  target.errors += Number(value.errors || 0);
  return agg.cacheMetrics.withCacheHitMetrics(target);
}
function emptyUsage() { return agg.cacheMetrics.withCacheHitMetrics({ total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 }); }
function addUsage(a, b) { return addTokenInto(a, b); }
function combinePercentile(values = [], p = 95) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return nums.length ? agg.percentile(nums, p) : null;
}
function latencySamples(item = {}) {
  return Array.isArray(item._latencyValues)
    ? item._latencyValues.filter((value) => Number.isFinite(Number(value))).map(Number)
    : [];
}
function optionalNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function aggregateError(nativeError, page) { if (nativeError) page.nativeError = safeDbError(nativeError); return page; }
function sourceList(payload = {}) {
  return listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload));
}
function timeWindows(payload = {}) {
  const timestamp = Number(payload.timestamp || Date.now());
  const dayStart = new Date(timestamp);
  dayStart.setHours(0, 0, 0, 0);
  const windowHours = Math.max(1, Math.min(24 * 365, Number(payload.windowHours || 24)));
  return {
    timestamp,
    dayStartMs: dayStart.getTime(),
    windowStartMs: timestamp - windowHours * 60 * 60 * 1000,
    weekStartMs: timestamp - 7 * 24 * 60 * 60 * 1000,
  };
}
function normalizeTrendRange(payload = {}) {
  const timestamp = Number(payload.timestamp || Date.now());
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const bucketMs = Math.max(60 * 1000, Number(payload.bucketMs || (payload.bucket === 'day' ? day : hour)) || hour);
  const startValue = payload.start ?? payload.range?.start ?? (payload.bucket === 'day' ? timestamp - 14 * day : timestamp - 24 * hour);
  const endValue = payload.endExclusive ?? payload.end ?? payload.range?.endExclusive ?? payload.range?.end ?? timestamp;
  const start = Number(startValue);
  const end = Number(endValue);
  const reference = Number.isFinite(start) && Number.isFinite(end) ? start + (end - start) / 2 : timestamp;
  const localOffset = -new Date(reference).getTimezoneOffset() * 60 * 1000;
  const requestedOffset = Number(payload.bucketOffsetMs);
  const hasExplicitOffset = Number.isFinite(requestedOffset);
  const bucketOffsetMs = hasExplicitOffset
    ? Math.max(-day, Math.min(day, requestedOffset))
    : localOffset;
  const endExclusive = end;
  // Compact rollups remain the bounded path for very wide/all-time charts;
  // calendar rebucketing is needed for normal date windows where DST can
  // otherwise omit or duplicate a local day.
  const calendarRebucket = !hasExplicitOffset && bucketMs >= day && (endExclusive - start) <= 400 * day && hasLocalOffsetTransition(start, endExclusive);
  const transitionBucketMs = calendarRebucket && hasHalfHourOffsetTransition(start, endExclusive) ? 30 * 60 * 1000 : hour;
  return {
    timestamp, start, end, endExclusive, bucketMs, bucketOffsetMs,
    calendarRebucket,
    queryBucketMs: calendarRebucket ? transitionBucketMs : bucketMs,
    queryBucketOffsetMs: calendarRebucket ? 0 : bucketOffsetMs,
  };
}
function localOffsetMs(timestamp) { return -new Date(timestamp).getTimezoneOffset() * 60 * 1000; }
function hasLocalOffsetTransition(start, end) {
  if (!(Number.isFinite(start) && Number.isFinite(end)) || end <= start) return false;
  const step = 6 * 60 * 60 * 1000;
  let previous = localOffsetMs(start);
  for (let at = start + step; at < end; at += step) {
    const current = localOffsetMs(at);
    if (current !== previous) return true;
    previous = current;
  }
  return localOffsetMs(end - 1) !== previous;
}
function hasHalfHourOffsetTransition(start, end) {
  if (!(Number.isFinite(start) && Number.isFinite(end)) || end <= start) return false;
  const step = 6 * 60 * 60 * 1000;
  let previous = localOffsetMs(start);
  for (let at = start + step; at < end; at += step) {
    const current = localOffsetMs(at);
    if (Math.abs(current - previous) % (60 * 60 * 1000) !== 0) return true;
    previous = current;
  }
  const current = localOffsetMs(end - 1);
  return Math.abs(current - previous) % (60 * 60 * 1000) !== 0;
}
function localDayStartMs(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
function nextLocalDayStartMs(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}
function rebucketCalendarDays(items = [], trendRange = {}) {
  const start = Number(trendRange.start || 0);
  const endExclusive = Number(trendRange.endExclusive ?? trendRange.end ?? 0);
  if (!(start > 0) || !(endExclusive > start)) return items;
  const map = new Map();
  for (const item of items || []) {
    const key = localDayStartMs(Number(item.start || 0));
    const prev = map.get(key) || { start: key, end: nextLocalDayStartMs(key), total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, latencyAvg: null, latencyP95: null, _latencyWeighted: 0, _latencySamples: 0, _latencyValues: [], _latencyFallbacks: [] };
    addUsage(prev, item);
    const samples = latencySamples(item);
    const sampleWeight = samples.length || Number(item.messages || 0);
    if (Number.isFinite(item.latencyAvg) && sampleWeight > 0) {
      prev._latencyWeighted += item.latencyAvg * sampleWeight;
      prev._latencySamples += sampleWeight;
    }
    if (samples.length) prev._latencyValues.push(...samples);
    else if (Number.isFinite(item.latencyP95)) prev._latencyFallbacks.push(Number(item.latencyP95));
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => a.start - b.start).map((item) => {
    item.latencyAvg = item._latencySamples ? item._latencyWeighted / item._latencySamples : null;
    item.latencyP95 = item._latencyValues.length
      ? combinePercentile(item._latencyValues)
      : item._latencyFallbacks.length === 1 ? item._latencyFallbacks[0] : null;
    const samples = item._latencyValues.slice();
    delete item._latencyWeighted; delete item._latencySamples;
    delete item._latencyValues; delete item._latencyFallbacks;
    Object.defineProperty(item, '_latencyValues', { value: samples, enumerable: false, configurable: true });
    item.label = new Date(item.start).toLocaleString('zh-CN', { hour12: false });
    return agg.cacheMetrics.withCacheHitMetrics(item);
  });
}
function mergeSummaryParts(parts, payload = {}) {
  const usage = { today: emptyUsage(), window: emptyUsage(), week: emptyUsage(), all: emptyUsage() };
  const sources = [];
  for (const part of parts) {
    if (!part) continue;
    addUsage(usage.today, part.usage.today);
    addUsage(usage.window, part.usage.window);
    addUsage(usage.week, part.usage.week);
    addUsage(usage.all, part.usage.all);
    sources.push(part.source);
  }
  return { ok: true, timestamp: Number(payload.timestamp || Date.now()), usage, sources };
}
function summaryFromDashboardBundle(bundle = {}, payload = {}) {
  return {
    ok: true,
    timestamp: Number(bundle.timestamp || payload.timestamp || Date.now()),
    usage: bundle.usage || {},
    sources: bundle.sources || [],
    sourceErrors: bundle.sourceErrors || [],
    perf: bundle.perf,
  };
}
function trendFromDashboardBundle(bundle = {}, payload = {}) {
  const trendRange = normalizeTrendRange(payload);
  return {
    ok: true,
    timestamp: Number(bundle.timestamp || payload.timestamp || Date.now()),
    start: Number(bundle.start || trendRange.start),
    end: Number(bundle.end || trendRange.end),
    bucketMs: Number(bundle.bucketMs || trendRange.bucketMs),
    bucketOffsetMs: Number(bundle.bucketOffsetMs ?? trendRange.bucketOffsetMs),
    buckets: densifyBuckets(bundle.buckets || [], trendRange),
    sourceErrors: bundle.sourceErrors || [],
    perf: bundle.perf,
  };
}
function sourceStatsFromDashboardBundle(bundle = {}, payload = {}) {
  return {
    ok: true,
    timestamp: Number(bundle.timestamp || payload.timestamp || Date.now()),
    items: bundle.sourceStats || [],
    sourceErrors: bundle.sourceErrors || [],
    perf: bundle.perf,
  };
}
function modelStatsFromDashboardBundle(bundle = {}, payload = {}) {
  return {
    ok: true,
    timestamp: Number(bundle.timestamp || payload.timestamp || Date.now()),
    items: bundle.modelStats || [],
    sourceErrors: bundle.sourceErrors || [],
    perf: bundle.perf,
  };
}
function mergeBuckets(items, bucketMs) {
  const map = new Map();
  for (const item of items || []) {
    const key = Number(item.start || 0);
    const prev = map.get(key) || { start: key, end: key + bucketMs, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, latencyAvg: null, latencyP95: null, _latencyWeighted: 0, _latencySamples: 0, _latencyValues: [], _latencyFallbacks: [] };
    addUsage(prev, item);
    const samples = latencySamples(item);
    const sampleWeight = samples.length || Number(item.messages || 0);
    if (Number.isFinite(item.latencyAvg) && sampleWeight > 0) {
      prev._latencyWeighted += item.latencyAvg * sampleWeight;
      prev._latencySamples += sampleWeight;
    }
    if (samples.length) prev._latencyValues.push(...samples);
    else if (Number.isFinite(item.latencyP95)) prev._latencyFallbacks.push(Number(item.latencyP95));
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => a.start - b.start).map((b) => {
    b.latencyAvg = b._latencySamples ? b._latencyWeighted / b._latencySamples : null;
    b.latencyP95 = b._latencyValues.length
      ? combinePercentile(b._latencyValues)
      : b._latencyFallbacks.length === 1 ? b._latencyFallbacks[0] : null;
    const samples = b._latencyValues.slice();
    delete b._latencyWeighted; delete b._latencySamples;
    delete b._latencyValues; delete b._latencyFallbacks;
    Object.defineProperty(b, '_latencyValues', { value: samples, enumerable: false, configurable: true });
    b.label = new Date(b.start).toLocaleString('zh-CN', { hour12: false });
    return agg.cacheMetrics.withCacheHitMetrics(b);
  });
}
function densifyBuckets(items, trendRange = {}, maxBuckets = 400) {
  const bucketMs = Math.max(60000, Number(trendRange.bucketMs || 3600000));
  const offset = Number(trendRange.bucketOffsetMs || 0);
  const start = Number(trendRange.start || 0);
  const endExclusive = Number(trendRange.endExclusive ?? trendRange.end ?? 0);
  if (!(start > 0) || !(endExclusive > start)) return items || [];
  if (trendRange.calendarRebucket) {
    const first = localDayStartMs(start);
    const last = localDayStartMs(endExclusive - 1);
    const dense = [];
    const byStart = new Map((items || []).map((item) => [Number(item.start || 0), item]));
    for (let cursor = first, count = 0; cursor <= last && count < maxBuckets; cursor = nextLocalDayStartMs(cursor), count += 1) {
      dense.push(byStart.get(cursor) || agg.cacheMetrics.withCacheHitMetrics({
        start: cursor, end: nextLocalDayStartMs(cursor), total: 0, input: 0, output: 0, reasoning: 0,
        cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, latencyAvg: null, latencyP95: null,
        label: new Date(cursor).toLocaleString('zh-CN', { hour12: false }),
      }));
    }
    return dense;
  }
  const first = Math.floor((start + offset) / bucketMs) * bucketMs - offset;
  const last = Math.floor((endExclusive - 1 + offset) / bucketMs) * bucketMs - offset;
  const count = Math.floor((last - first) / bucketMs) + 1;
  if (count <= 0 || count > maxBuckets) return items || [];
  const byStart = new Map((items || []).map((item) => [Number(item.start || 0), item]));
  const dense = [];
  for (let index = 0; index < count; index++) {
    const bucketStart = first + index * bucketMs;
    dense.push(byStart.get(bucketStart) || agg.cacheMetrics.withCacheHitMetrics({
      start: bucketStart,
      end: bucketStart + bucketMs,
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      messages: 0,
      errors: 0,
      latencyAvg: null,
      latencyP95: null,
      label: new Date(bucketStart).toLocaleString('zh-CN', { hour12: false }),
    }));
  }
  return dense;
}
function mergeModelStats(items) {
  const map = new Map();
  for (const arr of items || []) for (const item of arr || []) {
    const key = item.name || `${item.provider} / ${item.model}`;
    const prev = map.get(key) || {
      name: key, provider: item.provider, model: item.model,
      total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0,
      sources: [], _performanceParts: [], _latencyValues: [], _latencyCount: 0,
      _latencyWeighted: 0, _latencyMin: null, _latencyMax: null, _latencyFallbacks: [], _latencyValuesComplete: true,
    };
    addUsage(prev, item);
    prev.sources.push(item.source);
    const performance = item.performance || {};
    const latency = performance.latency || {};
    const count = Math.max(0, Number(latency.count || 0));
    const samples = latencySamples(item);
    const latencyAvg = optionalNumber(latency.avg);
    const latencyMin = optionalNumber(latency.min);
    const latencyMax = optionalNumber(latency.max);
    const latencyP95 = optionalNumber(latency.p95);
    prev._performanceParts.push(performance);
    prev._latencyCount += count;
    if (count > 0 && latencyAvg != null) prev._latencyWeighted += latencyAvg * count;
    if (latencyMin != null) prev._latencyMin = prev._latencyMin == null ? latencyMin : Math.min(prev._latencyMin, latencyMin);
    if (latencyMax != null) prev._latencyMax = prev._latencyMax == null ? latencyMax : Math.max(prev._latencyMax, latencyMax);
    if (samples.length) prev._latencyValues.push(...samples);
    if (samples.length < count) prev._latencyValuesComplete = false;
    if (latencyP95 != null) prev._latencyFallbacks.push(latencyP95);
    map.set(key, prev);
  }
  return [...map.values()].map((item) => {
    const basePerformance = item._performanceParts.length === 1 ? item._performanceParts[0] : {};
    const completeLatency = item._latencyValuesComplete && item._latencyValues.length
      ? agg.summarize(item._latencyValues)
      : null;
    const latencyP95 = completeLatency?.p95
      ?? (item._latencyFallbacks.length === 1 ? item._latencyFallbacks[0] : null);
    const performance = {
      ttft: basePerformance.ttft || agg.summarize([]),
      firstContentApprox: basePerformance.firstContentApprox || agg.summarize([]),
      outputTokensPerSec: basePerformance.outputTokensPerSec || agg.summarize([]),
      totalTokensPerSec: basePerformance.totalTokensPerSec || agg.summarize([]),
      latency: {
        count: item._latencyCount,
        min: item._latencyMin,
        avg: item._latencyCount ? item._latencyWeighted / item._latencyCount : null,
        p50: completeLatency?.p50 ?? null,
        p90: completeLatency?.p90 ?? null,
        p95: latencyP95,
        p99: completeLatency?.p99 ?? null,
        max: item._latencyMax,
      },
    };
    delete item._performanceParts; delete item._latencyValues; delete item._latencyCount;
    delete item._latencyWeighted; delete item._latencyMin; delete item._latencyMax;
    delete item._latencyFallbacks; delete item._latencyValuesComplete;
    item.sources = [...new Set(item.sources.filter(Boolean))];
    return agg.cacheMetrics.withCacheHitMetrics({ ...item, performance });
  }).sort((a, b) => b.total - a.total);
}
function mergeSessionSummaries(items, payload = {}, errors = []) {
  const out = { ok: true, timestamp: Number(payload.timestamp || Date.now()), total: 0, active: 0, archived: 0, recent7d: 0, bySource: [], projects: [], sourceErrors: errors };
  const projectMap = new Map();
  for (const item of items || []) {
    out.total += item.total || 0;
    out.active += item.active || 0;
    out.archived += item.archived || 0;
    out.recent7d += item.recent7d || 0;
    out.bySource.push({ source: item.source, label: item.sourceLabel, total: item.total, active: item.active, archived: item.archived, recent7d: item.recent7d });
    for (const p of item.projects || []) {
      const prev = projectMap.get(p.key) || { ...p, count: 0, active: 0, archived: 0, updatedAt: 0 };
      prev.count += p.count || 0;
      prev.active += p.active || 0;
      prev.archived += p.archived || 0;
      prev.updatedAt = Math.max(prev.updatedAt || 0, p.updatedAt || 0);
      projectMap.set(p.key, prev);
    }
  }
  out.projects = [...projectMap.values()].sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt).slice(0, 20);
  return out;
}

module.exports = {
  timeAggregateSync,
  timeAggregateAsync,
  emptyUsage,
  addUsage,
  aggregateError,
  sourceList,
  timeWindows,
  normalizeTrendRange,
  rebucketCalendarDays,
  mergeSummaryParts,
  summaryFromDashboardBundle,
  trendFromDashboardBundle,
  sourceStatsFromDashboardBundle,
  modelStatsFromDashboardBundle,
  mergeBuckets,
  densifyBuckets,
  mergeModelStats,
  mergeSessionSummaries,
  slowAggregateStats,
  resetSlowAggregateStats,
  maybeLogSlowAggregate,
};
