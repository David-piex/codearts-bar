'use strict';

const agg = require('../../core/aggregator');
const { normalizeRange } = require('./sources');

const HOUR_MS = 60 * 60 * 1000;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function emptyUsage() {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    messages: 0,
    errors: 0,
  });
}
function addUsageRow(target, row = {}) {
  target.total += toNumber(row.total);
  target.input += toNumber(row.input);
  target.output += toNumber(row.output);
  target.reasoning += toNumber(row.reasoning);
  target.cacheRead += toNumber(row.cacheRead);
  target.cacheWrite += toNumber(row.cacheWrite);
  target.messages += toNumber(row.messages, 1);
  target.errors += toNumber(row.errors);
  return target;
}
function finalizeUsage(usage) {
  return agg.cacheMetrics.withCacheHitMetrics(usage);
}
function normalizeTokenRows(rows = []) {
  return (rows || []).map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    timeCreated: toNumber(row.timeCreated),
    timeUpdated: toNumber(row.timeUpdated),
    provider: row.provider || 'unknown',
    model: row.model || 'unknown',
    total: toNumber(row.total),
    input: toNumber(row.input),
    output: toNumber(row.output),
    reasoning: toNumber(row.reasoning),
    cacheRead: toNumber(row.cacheRead),
    cacheWrite: toNumber(row.cacheWrite),
    messages: toNumber(row.messages, 1),
    errors: toNumber(row.errors),
    latencyMs: row.latencyMs == null ? null : Number(row.latencyMs),
  }));
}
function normalizeSessionRows(rows = []) {
  return (rows || []).map((row) => ({
    id: row.id,
    title: row.title || '',
    directory: row.directory || '',
    timeCreated: toNumber(row.timeCreated),
    timeUpdated: toNumber(row.timeUpdated),
    timeArchived: row.timeArchived == null ? null : toNumber(row.timeArchived),
  }));
}
function emptyPlainUsage(extra = {}) {
  return {
    ...extra,
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    messages: 0,
    errors: 0,
    latencyTotal: 0,
    latencySamples: 0,
    latencyMax: null,
  };
}
function addCompactRow(target, row = {}) {
  addUsageRow(target, row);
  if (Number.isFinite(row.latencyMs)) {
    target.latencyTotal += row.latencyMs;
    target.latencySamples += 1;
    target.latencyMax = target.latencyMax == null ? row.latencyMs : Math.max(target.latencyMax, row.latencyMs);
  } else {
    target.latencyTotal += toNumber(row.latencyTotal);
    target.latencySamples += toNumber(row.latencySamples);
    if (Number.isFinite(row.latencyMax)) {
      target.latencyMax = target.latencyMax == null ? Number(row.latencyMax) : Math.max(target.latencyMax, Number(row.latencyMax));
    }
  }
  return target;
}
function finalizeCompactUsage(row = {}) {
  const out = finalizeUsage({
    total: toNumber(row.total),
    input: toNumber(row.input),
    output: toNumber(row.output),
    reasoning: toNumber(row.reasoning),
    cacheRead: toNumber(row.cacheRead),
    cacheWrite: toNumber(row.cacheWrite),
    messages: toNumber(row.messages),
    errors: toNumber(row.errors),
  });
  out.latencyAvg = latencyAverage(toNumber(row.latencyTotal), toNumber(row.latencySamples));
  out.latencyP95 = row.latencyMax == null ? null : Number(row.latencyMax);
  return out;
}
function normalizeCompactRows(rows = []) {
  return (rows || []).map((row) => ({
    ...row,
    start: toNumber(row.start),
    end: toNumber(row.end),
    provider: row.provider || undefined,
    model: row.model || undefined,
    total: toNumber(row.total),
    input: toNumber(row.input),
    output: toNumber(row.output),
    reasoning: toNumber(row.reasoning),
    cacheRead: toNumber(row.cacheRead),
    cacheWrite: toNumber(row.cacheWrite),
    messages: toNumber(row.messages),
    errors: toNumber(row.errors),
    latencyTotal: toNumber(row.latencyTotal),
    latencySamples: toNumber(row.latencySamples),
    latencyMax: row.latencyMax == null ? null : Number(row.latencyMax),
  }));
}
function buildCompactUsageRollup(source, rows = [], bucketMs = HOUR_MS) {
  const hourlyMap = new Map();
  const modelMap = new Map();
  let minTime = 0;
  let maxTime = 0;
  for (const row of normalizeTokenRows(rows)) {
    const time = toNumber(row.timeCreated);
    if (!time) continue;
    minTime = minTime ? Math.min(minTime, time) : time;
    maxTime = Math.max(maxTime, time);
    const start = Math.floor(time / bucketMs) * bucketMs;
    const hourly = hourlyMap.get(start) || emptyPlainUsage({ start, end: start + bucketMs });
    addCompactRow(hourly, row);
    hourlyMap.set(start, hourly);

    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const modelKey = `${start}\u0000${provider}\u0000${model}`;
    const modelBucket = modelMap.get(modelKey) || emptyPlainUsage({ start, end: start + bucketMs, provider, model });
    addCompactRow(modelBucket, row);
    modelMap.set(modelKey, modelBucket);
  }
  return {
    source: { id: source.id, label: source.label, dbPath: source.dbPath },
    bucketMs,
    rowCount: rows.length,
    minTime,
    maxTime,
    hourly: [...hourlyMap.values()].sort((a, b) => a.start - b.start),
    hourlyModels: [...modelMap.values()].sort((a, b) => a.start - b.start || String(a.provider).localeCompare(String(b.provider)) || String(a.model).localeCompare(String(b.model))),
  };
}
function filterRowsForPayload(rows = [], payload = {}) {
  const range = normalizeRange(payload.range || {});
  return rows.filter((row) => {
    const time = toNumber(row.timeCreated);
    if (range.start && time < range.start) return false;
    if (range.end && time >= range.end) return false;
    return true;
  });
}
function sumRows(rows = [], predicate = null) {
  const usage = emptyUsage();
  for (const row of rows) {
    if (predicate && !predicate(row)) continue;
    addUsageRow(usage, row);
  }
  return finalizeUsage(usage);
}
function latencyAverage(total, samples) {
  return samples > 0 ? total / samples : null;
}
function bucketBoundarySafe(boundary, minTime, maxTime, mode = 'start', bucketMs = HOUR_MS) {
  const value = toNumber(boundary);
  if (!value) return true;
  if (mode === 'start' && (!minTime || value <= minTime)) return true;
  if (mode === 'end' && (!maxTime || value > maxTime)) return true;
  if (mode === 'start') return value % bucketMs === 0;
  return value % bucketMs === 0;
}
function compactRollupIsSafeForDashboard(compact, { payload = {}, windows = {}, trendRange = {} } = {}) {
  if (trendRange.calendarRebucket) return false;
  if (!compact || !Array.isArray(compact.hourly) || !compact.hourly.length) return false;
  const bucketMs = Math.max(60000, toNumber(compact.bucketMs, HOUR_MS));
  if (bucketMs !== HOUR_MS) return false;
  const trendBucketMs = Math.max(60000, toNumber(trendRange.bucketMs, HOUR_MS));
  if (trendBucketMs < bucketMs || trendBucketMs % bucketMs !== 0) return false;
  if (toNumber(trendRange.bucketOffsetMs) % bucketMs !== 0) return false;
  const minTime = toNumber(compact.minTime);
  const maxTime = toNumber(compact.maxTime);
  const range = normalizeRange(payload.range || {});
  const starts = [range.start, windows.dayStartMs, windows.windowStartMs, windows.weekStartMs, trendRange.start];
  const ends = [range.end, trendRange.endExclusive ?? trendRange.end];
  return starts.every((value) => bucketBoundarySafe(value, minTime, maxTime, 'start', bucketMs))
    && ends.every((value) => bucketBoundarySafe(value, minTime, maxTime, 'end', bucketMs));
}
function compactRowsInRange(rows = [], start = 0, end = 0) {
  const s = toNumber(start);
  const e = toNumber(end);
  return rows.filter((row) => {
    const rowStart = toNumber(row.start);
    if (s && rowStart < s) return false;
    if (e && rowStart >= e) return false;
    return true;
  });
}
function sumCompactRows(rows = [], predicate = null) {
  const usage = emptyPlainUsage();
  for (const row of rows) {
    if (predicate && !predicate(row)) continue;
    addCompactRow(usage, row);
  }
  return finalizeCompactUsage(usage);
}
function trendBucketsFromCompact(compact, trendRange = {}) {
  const sourceBucketMs = Math.max(60000, toNumber(compact.bucketMs, HOUR_MS));
  const bucketMs = Math.max(sourceBucketMs, toNumber(trendRange.bucketMs, sourceBucketMs));
  const start = toNumber(trendRange.start);
  const end = toNumber(trendRange.endExclusive ?? trendRange.end);
  const bucketOffsetMs = toNumber(trendRange.bucketOffsetMs);
  const map = new Map();
  for (const row of compactRowsInRange(compact.hourly || [], start, end)) {
    const bucket = Math.floor((toNumber(row.start) + bucketOffsetMs) / bucketMs) * bucketMs - bucketOffsetMs;
    const prev = map.get(bucket) || emptyPlainUsage({ start: bucket, end: bucket + bucketMs });
    addCompactRow(prev, row);
    map.set(bucket, prev);
  }
  return [...map.values()].sort((a, b) => a.start - b.start).map((bucket) => ({
    start: bucket.start,
    end: bucket.end,
    label: new Date(bucket.start).toLocaleString('zh-CN', { hour12: false }),
    ...finalizeCompactUsage(bucket),
  }));
}
function modelStatsFromCompact(compact, payload = {}) {
  const range = normalizeRange(payload.range || {});
  const map = new Map();
  for (const row of compactRowsInRange(compact.hourlyModels || [], range.start, range.end)) {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const key = `${provider} / ${model}`;
    const prev = map.get(key) || emptyPlainUsage({ name: key, provider, model, source: compact.source?.id, sourceLabel: compact.source?.label });
    addCompactRow(prev, row);
    map.set(key, prev);
  }
  return [...map.values()].map((item) => {
    const usage = finalizeCompactUsage(item);
    return {
      name: item.name,
      provider: item.provider,
      model: item.model,
      total: usage.total,
      input: usage.input,
      output: usage.output,
      reasoning: usage.reasoning,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      messages: usage.messages,
      errors: usage.errors,
      cacheHitDenominator: usage.cacheHitDenominator,
      cacheHitRate: usage.cacheHitRate,
      source: item.source,
      sourceLabel: item.sourceLabel,
      performance: {
        latency: {
          count: toNumber(item.latencySamples),
          min: null,
          avg: usage.latencyAvg,
          p50: null,
          p90: null,
          p95: null,
          p99: null,
          max: item.latencyMax == null ? null : Number(item.latencyMax),
        },
        ttft: agg.summarize([]),
        firstContentApprox: agg.summarize([]),
        outputTokensPerSec: agg.summarize([]),
        totalTokensPerSec: agg.summarize([]),
      },
    };
  }).sort((a, b) => b.total - a.total);
}
function sessionSummaryPartFromRollup(rollup, payload = {}) {
  const source = rollup.source || {};
  const range = normalizeRange(payload.range || {});
  const project = payload.project && payload.project !== 'all' ? String(payload.project) : '';
  const timestamp = Number(payload.timestamp || Date.now());
  const weekAgo = timestamp - 7 * 86400000;
  const sessions = normalizeSessionRows(rollup.sessions || []).filter((row) => {
    const updated = toNumber(row.timeUpdated);
    if (range.start && updated < range.start) return false;
    if (range.end && updated >= range.end) return false;
    if (project && row.directory !== project) return false;
    return true;
  });
  const projects = new Map();
  let active = 0;
  let archived = 0;
  let recent7d = 0;
  for (const row of sessions) {
    if (row.timeArchived) archived += 1; else active += 1;
    if (toNumber(row.timeUpdated) >= weekAgo) recent7d += 1;
    const dir = row.directory || '';
    const key = dir || '__none';
    const prev = projects.get(key) || { key, directory: dir, count: 0, active: 0, archived: 0, updatedAt: 0 };
    prev.count += 1;
    if (row.timeArchived) prev.archived += 1; else prev.active += 1;
    prev.updatedAt = Math.max(prev.updatedAt || 0, toNumber(row.timeUpdated));
    projects.set(key, prev);
  }
  return {
    source: source.id,
    sourceLabel: source.label,
    total: sessions.length,
    active,
    archived,
    recent7d,
    projects: [...projects.values()].sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt).slice(0, 20),
    usageRollup: rollup.usageRollup || { status: 'session-hit', rowCount: sessions.length },
  };
}
function trendBucketsFromRows(rows = [], trendRange = {}) {
  const bucketMs = Math.max(60000, toNumber(trendRange.bucketMs, 3600000));
  const start = toNumber(trendRange.start);
  const end = toNumber(trendRange.endExclusive ?? trendRange.end);
  const bucketOffsetMs = toNumber(trendRange.bucketOffsetMs);
  const map = new Map();
  for (const row of rows) {
    const time = toNumber(row.timeCreated);
    if (start && time < start) continue;
    if (end && time >= end) continue;
    const bucket = Math.floor((time + bucketOffsetMs) / bucketMs) * bucketMs - bucketOffsetMs;
    const prev = map.get(bucket) || {
      start: bucket,
      end: bucket + bucketMs,
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      messages: 0,
      errors: 0,
      _latencyTotal: 0,
      _latencySamples: 0,
      latencyP95: null,
    };
    addUsageRow(prev, row);
    if (Number.isFinite(row.latencyMs)) {
      prev._latencyTotal += row.latencyMs;
      prev._latencySamples += 1;
      prev.latencyP95 = Math.max(prev.latencyP95 || 0, row.latencyMs);
    }
    map.set(bucket, prev);
  }
  return [...map.values()].sort((a, b) => a.start - b.start).map((bucket) => {
    bucket.latencyAvg = latencyAverage(bucket._latencyTotal, bucket._latencySamples);
    if (!bucket.latencyP95) bucket.latencyP95 = null;
    delete bucket._latencyTotal;
    delete bucket._latencySamples;
    bucket.label = new Date(bucket.start).toLocaleString('zh-CN', { hour12: false });
    return finalizeUsage(bucket);
  });
}
function modelStatsFromRows(rows = [], source = {}) {
  const map = new Map();
  for (const row of rows) {
    const provider = row.provider || 'unknown';
    const model = row.model || 'unknown';
    const key = `${provider} / ${model}`;
    const prev = map.get(key) || {
      name: key,
      provider,
      model,
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      messages: 0,
      errors: 0,
      source: source.id,
      sourceLabel: source.label,
      _latencyTotal: 0,
      _latencyCount: 0,
      _latencyMin: null,
      _latencyMax: null,
    };
    addUsageRow(prev, row);
    if (Number.isFinite(row.latencyMs)) {
      prev._latencyTotal += row.latencyMs;
      prev._latencyCount += 1;
      prev._latencyMin = prev._latencyMin == null ? row.latencyMs : Math.min(prev._latencyMin, row.latencyMs);
      prev._latencyMax = prev._latencyMax == null ? row.latencyMs : Math.max(prev._latencyMax, row.latencyMs);
    }
    map.set(key, prev);
  }
  return [...map.values()].map((item) => {
    const latency = {
      count: item._latencyCount,
      min: item._latencyMin,
      avg: latencyAverage(item._latencyTotal, item._latencyCount),
      p50: null,
      p90: null,
      p95: null,
      p99: null,
      max: item._latencyMax,
    };
    delete item._latencyTotal;
    delete item._latencyCount;
    delete item._latencyMin;
    delete item._latencyMax;
    return finalizeUsage({
      ...item,
      performance: {
        latency,
        ttft: agg.summarize([]),
        firstContentApprox: agg.summarize([]),
        outputTokensPerSec: agg.summarize([]),
        totalTokensPerSec: agg.summarize([]),
      },
    });
  }).sort((a, b) => b.total - a.total);
}
function dashboardPartFromCompactRollup(compact, { payload = {}, windows = {}, trendRange = {} } = {}) {
  const source = compact.source || {};
  const range = normalizeRange(payload.range || {});
  const scoped = compactRowsInRange(compact.hourly || [], range.start, range.end);
  const all = sumCompactRows(scoped);
  return {
    source,
    summary: {
      source,
      usage: {
        today: sumCompactRows(scoped, (row) => toNumber(row.start) >= toNumber(windows.dayStartMs)),
        window: sumCompactRows(scoped, (row) => toNumber(row.start) >= toNumber(windows.windowStartMs)),
        week: sumCompactRows(scoped, (row) => toNumber(row.start) >= toNumber(windows.weekStartMs)),
        all,
      },
    },
    sourceStat: {
      key: source.id,
      source: source.id,
      label: source.label,
      requests: all.messages,
      ...all,
    },
    modelStats: modelStatsFromCompact(compact, payload),
    trendBuckets: trendBucketsFromCompact(compact, trendRange),
    sessionSummary: compact.sessionSummary || null,
    usageRollup: compact.usageRollup || { status: 'compact-hit', rowCount: compact.rowCount, compactBuckets: (compact.hourly || []).length },
  };
}
function dashboardPartFromUsageRollup(rollup, { payload = {}, windows = {}, trendRange = {} } = {}) {
  const source = rollup.source || {};
  const scopedRows = filterRowsForPayload(rollup.rows || [], payload);
  const all = sumRows(scopedRows);
  return {
    source,
    summary: {
      source,
      usage: {
        today: sumRows(scopedRows, (row) => toNumber(row.timeCreated) >= toNumber(windows.dayStartMs)),
        window: sumRows(scopedRows, (row) => toNumber(row.timeCreated) >= toNumber(windows.windowStartMs)),
        week: sumRows(scopedRows, (row) => toNumber(row.timeCreated) >= toNumber(windows.weekStartMs)),
        all,
      },
    },
    sourceStat: {
      key: source.id,
      source: source.id,
      label: source.label,
      requests: all.messages,
      ...all,
    },
    modelStats: modelStatsFromRows(scopedRows, source),
    trendBuckets: trendBucketsFromRows(scopedRows, trendRange),
    sessionSummary: rollup.sessionSummary || null,
    usageRollup: rollup.usageRollup || { status: 'unknown', rowCount: (rollup.rows || []).length },
  };
}

module.exports = {
  toNumber,
  emptyUsage,
  addUsageRow,
  finalizeUsage,
  normalizeTokenRows,
  normalizeSessionRows,
  emptyPlainUsage,
  addCompactRow,
  finalizeCompactUsage,
  normalizeCompactRows,
  buildCompactUsageRollup,
  filterRowsForPayload,
  sumRows,
  latencyAverage,
  bucketBoundarySafe,
  compactRollupIsSafeForDashboard,
  compactRowsInRange,
  sumCompactRows,
  trendBucketsFromCompact,
  modelStatsFromCompact,
  sessionSummaryPartFromRollup,
  trendBucketsFromRows,
  modelStatsFromRows,
  dashboardPartFromCompactRollup,
  dashboardPartFromUsageRollup,
};
