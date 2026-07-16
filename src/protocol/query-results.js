'use strict';

const { envelope, failure } = require('./envelope');
const { redactSensitiveText } = require('../core/sensitive-text');

function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }

function safeIdeText(value, maxLength = 2000) {
  return redactSensitiveText(value == null ? '' : String(value))
    .split(/\r?\n/, 1)[0]
    .replace(/\b(?:file:\/\/\/)?[A-Za-z]:[\\/][^\s\r\n"'<>|,;)\]}]*/gi, '[path]')
    .replace(/\\\\[^\\/\s]+[\\/][^\s\r\n"'<>|,;)\]}]*/g, '[path]')
    .replace(/(^|[\s("'=:\[])\/(?!\/)[^\s\r\n"'<>|,;)\]}]*/gm, '$1[path]')
    .slice(0, maxLength);
}

const OMITTED_IDE_FIELDS = /^(?:dbPath|databasePath|prompt|toolInput|toolOutput)$/i;
const PRIVATE_IDE_TEXT_FIELDS = /(?:error|message|stack|detail|reason|cause)$/i;

function sanitizeIdeValue(value, key = '') {
  if (typeof value === 'string') return PRIVATE_IDE_TEXT_FIELDS.test(key) ? safeIdeText(value) : redactSensitiveText(value);
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeIdeValue(item, key));
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !OMITTED_IDE_FIELDS.test(name))
    .map(([name, item]) => [name, sanitizeIdeValue(item, name)]));
}

function databasePagePayload(result = {}, options = {}) {
  const pageSize = Math.max(1, Math.trunc(finite(result.limit, finite(options.pageSize, 50))));
  const offset = Math.max(0, Math.trunc(finite(result.offset, (Math.max(1, Math.trunc(finite(options.page, 1))) - 1) * pageSize)));
  const total = Math.max(0, Math.trunc(finite(result.total, 0)));
  const page = Math.floor(offset / pageSize) + 1;
  const items = (result.items || []).map((item) => {
    const { dbPath: _dbPath, prompt: _prompt, toolInput: _toolInput, toolOutput: _toolOutput, ...safe } = item || {};
    if ('title' in safe) safe.title = safeIdeText(safe.title, 500);
    if ('sessionTitle' in safe) safe.sessionTitle = safeIdeText(safe.sessionTitle, 500);
    if ('error' in safe) safe.error = safeIdeText(safe.error);
    return sanitizeIdeValue(safe);
  });
  return envelope({ items, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), hasMore: Boolean(result.hasMore), strategy: result.strategy || 'database' }, { ...options, diagnostics: { adapter: result.nativeError ? 'sql.js' : 'node:sqlite', cache: null } });
}

function usageFromBuckets(buckets = []) {
  const fields = ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'messages', 'errors', 'cacheHitDenominator'];
  const usage = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const bucket of buckets || []) for (const field of fields) usage[field] += Number(bucket?.[field] || 0);
  usage.cacheHitRate = usage.cacheHitDenominator > 0 ? (usage.cacheRead / usage.cacheHitDenominator) * 100 : null;
  return usage;
}

function providerStatsFromModels(models = []) {
  const providers = new Map();
  for (const model of models) {
    const key = model.provider || 'unknown';
    const item = providers.get(key) || { name: key, provider: key, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, models: [] };
    for (const field of ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'messages', 'errors']) item[field] += Number(model[field] || 0);
    item.models.push(model.model || model.name || 'unknown');
    providers.set(key, item);
  }
  return [...providers.values()].map((item) => ({ ...item, models: [...new Set(item.models)] })).sort((left, right) => right.total - left.total);
}

function projectStatsFromSummary(summary = {}) {
  return (summary.projects || []).map((item) => ({
    id: item.key || item.directory || '__none',
    directory: item.directory || '',
    count: finite(item.count), active: finite(item.active), archived: finite(item.archived), updatedAt: finite(item.updatedAt),
  }));
}

function summarize(values = []) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((left, right) => left - right);
  const at = (percent) => sorted.length ? sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)] : null;
  return { count: sorted.length, min: sorted[0] ?? null, avg: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null, p50: at(50), p95: at(95), max: sorted.at(-1) ?? null };
}

function performanceFromBuckets(buckets = [], usage = usageFromBuckets(buckets)) {
  const latency = summarize(buckets.flatMap((bucket) => Array.isArray(bucket?._latencyValues) ? bucket._latencyValues : []));
  const samples = Number(usage.messages || 0);
  const errors = Number(usage.errors || 0);
  return { samples, completed: latency.count, errors, errorRate: samples ? errors / samples : 0, latency, complete: !samples || latency.count > 0 };
}

function sourceId(source) {
  if (typeof source === 'string' || typeof source === 'number') return String(source);
  return source?.id || source?.source || source?.key || '';
}

function analyticsSourceCoverage(result = {}) {
  const read = new Set();
  const failed = new Set();
  let anonymousFailures = 0;
  for (const source of result.sources || []) {
    const id = sourceId(source);
    if (id) read.add(String(id));
  }
  for (const source of result.sourceStats || []) {
    const id = sourceId(source);
    if (id) read.add(String(id));
  }
  for (const error of result.sourceErrors || []) {
    const id = sourceId(error);
    if (id) {
      const key = String(id);
      failed.add(key);
      read.delete(key);
    }
    else anonymousFailures += 1;
  }
  const expectedSources = result.sourceCoverage?.expectedSources ?? result.expectedSources;
  const expected = Array.isArray(expectedSources)
    ? new Set([...read, ...failed, ...expectedSources.map(sourceId).filter(Boolean)]).size + anonymousFailures
    : Number.isFinite(Number(expectedSources))
      ? Math.max(read.size + failed.size + anonymousFailures, Math.max(0, Math.trunc(Number(expectedSources))))
      : new Set([...read, ...failed]).size + anonymousFailures;
  return {
    expected,
    read: read.size,
    failed: failed.size + anonymousFailures,
    missing: Math.max(0, expected - read.size - failed.size - anonymousFailures),
  };
}

function analyticsPayload(result = {}, options = {}) {
  const buckets = Array.isArray(result.buckets) ? result.buckets : [];
  const usage = usageFromBuckets(buckets);
  const performance = result.performance && Number(result.performance.samples) === Number(usage.messages)
    ? result.performance : performanceFromBuckets(buckets, usage);
  const sourceCoverage = analyticsSourceCoverage(result);
  const completenessReasons = [];
  if (sourceCoverage.failed) completenessReasons.push('source-read-failed');
  if (sourceCoverage.missing) completenessReasons.push('source-coverage-missing');
  return envelope(sanitizeIdeValue({
    start: result.start || options.range?.start || 0,
    end: result.end || options.range?.end || 0,
    bucketMs: result.bucketMs || options.bucketMs || 0,
    bucketOffsetMs: result.bucketOffsetMs ?? options.bucketOffsetMs ?? 0,
    usage, trend: buckets,
    models: result.modelStats || [], providers: providerStatsFromModels(result.modelStats || []), sources: result.sourceStats || [],
    projects: projectStatsFromSummary(result.sessionSummary || {}),
    performance,
    rollupState: result.rollupState || result.perf?.usageRollup?.current || null,
    completeness: {
      complete: completenessReasons.length === 0,
      sampled: false,
      reasons: completenessReasons,
      sources: sourceCoverage,
      metrics: performance.metricCompleteness || { latency: performance.complete !== false, firstContentApprox: false, outputTokensPerSec: false, ttft: false },
    },
  }), options);
}

function ideDashboardPayload(snapshot = {}, options = {}) {
  const sourceCoverage = analyticsSourceCoverage({
    sources: snapshot.sources,
    sourceStats: snapshot.sourceStats,
    sourceErrors: snapshot.sourceErrors,
    expectedSources: snapshot.expectedSources,
    sourceCoverage: snapshot.sourceCoverage,
  });
  const completenessReasons = [];
  if (sourceCoverage.failed) completenessReasons.push('source-read-failed');
  if (sourceCoverage.missing) completenessReasons.push('source-coverage-missing');
  return envelope(sanitizeIdeValue({
    updatedAt: snapshot.updatedAt || '', dbSize: finite(snapshot.dbSize), adapter: snapshot.adapter || '', config: snapshot.config || {},
    status: snapshot.status || {}, usage: snapshot.usage || {}, trends: snapshot.trends || {}, models: snapshot.models || [], sources: snapshot.sourceStats || snapshot.sources || [],
    sessionSummary: snapshot.sessionSummary || {}, performance: snapshot.performance || {}, queue: snapshot.queue || {}, health: snapshot.health || {}, quota: snapshot.quota || {}, rollupState: snapshot.rollupState || null,
    completeness: { complete: completenessReasons.length === 0, sampled: false, reasons: completenessReasons, sources: sourceCoverage },
  }), { ...options, generatedAt: finite(snapshot.timestamp, Date.now()), diagnostics: { adapter: snapshot.adapter || '', cache: null } });
}

module.exports = { envelope, failure, safeIdeText, sanitizeIdeValue, databasePagePayload, usageFromBuckets, providerStatsFromModels, projectStatsFromSummary, performanceFromBuckets, analyticsSourceCoverage, analyticsPayload, ideDashboardPayload };
