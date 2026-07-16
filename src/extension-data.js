'use strict';

const { buildQuota } = require('./quota');
const { buildHealth } = require('./health');
const localProvider = require('./providers/codeartsLocal');
const { fmtTime } = require('./core/format');
const fs = require('fs');
const path = require('path');
const cacheMetrics = require('./core/cacheMetrics');
const { redactSensitiveText } = require('./core/sensitive-text');
const {
  safeIdeText,
  usageFromBuckets,
  providerStatsFromModels,
  performanceFromBuckets,
  analyticsSourceCoverage,
} = require('./protocol/query-results');

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

function extensionRange(options = {}, timestamp = Date.now()) {
  const preset = String(options.rangePreset || options.range?.preset || 'week');
  const dayStart = new Date(timestamp); dayStart.setHours(0, 0, 0, 0);
  const starts = { today: dayStart.getTime(), window: timestamp - DAY_MS, week: timestamp - 7 * DAY_MS, '14d': timestamp - 14 * DAY_MS, '30d': timestamp - 30 * DAY_MS, all: 0 };
  const start = preset === 'custom' ? Number(options.range?.start) : starts[preset];
  const end = preset === 'custom' ? Number(options.range?.end) : timestamp;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('请选择有效的开始和结束时间');
  if (end > timestamp + 60000) throw new Error('结束时间不能晚于当前时间');
  if (preset === 'custom' && end - start > 366 * DAY_MS) throw new Error('时间范围最多支持 366 天');
  const bucketMs = end - start <= 48 * HOUR_MS ? HOUR_MS : DAY_MS;
  return { preset, start, end, endExclusive: end, bucketMs };
}

function scopedUsage(items = []) {
  const usage = items.reduce((sum, item) => {
    for (const key of ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'errors']) sum[key] += Number(item[key] || 0);
    sum.messages += Number(item.messages ?? item.requests ?? 0);
    return sum;
  }, { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 });
  return cacheMetrics.withCacheHitMetrics(usage);
}


function sourceBytes(sources = []) {
  return sources.reduce((sum, source) => {
    const declared = Number(source.size || 0);
    if (declared > 0) return sum + declared;
    try { return sum + fs.statSync(source.dbPath).size; } catch { return sum; }
  }, 0);
}

function extensionConfig(options = {}) {
  return {
    ...options,
    dailyLimit: Number(options.dailyLimit || process.env.CODEARTS_BAR_DAILY_LIMIT || 200000),
    windowHours: Number(options.windowHours || process.env.CODEARTS_BAR_WINDOW_HOURS || 24),
    useSavedSettings: false,
  };
}

function extensionCapabilities() {
  return { performance: true, queue: false, diagnostics: true, providerStats: true };
}

function emptyPerformance() {
  return { window: { latency: {}, ttft: {}, firstContentApprox: {}, outputTokensPerSec: {}, errorRate: 0 } };
}

function extensionCompleteness(result = {}, performance = {}) {
  const sources = analyticsSourceCoverage(result);
  const reasons = [];
  if (sources.failed) reasons.push('source-read-failed');
  if (sources.missing) reasons.push('source-coverage-missing');
  return {
    complete: reasons.length === 0,
    sampled: false,
    reasons,
    sources,
    metrics: performance.metricCompleteness || {
      latency: performance.complete !== false,
      firstContentApprox: false,
      outputTokensPerSec: false,
      ttft: false,
    },
  };
}

function currentUsageOptions(config, timestamp) {
  const current = { ...config, source: 'all', model: 'all', project: 'all', timestamp };
  for (const key of ['range', 'rangePreset', 'start', 'end', 'endExclusive']) delete current[key];
  return current;
}

function applyDerived(snapshot, config) {
  const today = snapshot.usage?.today || {};
  const percent = config.dailyLimit > 0 ? Math.min(999, Math.max(0, (Number(today.total || 0) / config.dailyLimit) * 100)) : 0;
  snapshot.config = { dailyLimit: config.dailyLimit, windowHours: config.windowHours };
  snapshot.status = { label: `${Math.round(percent)}%`, usagePercent: percent, level: percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'ok' };
  try {
    snapshot.quota = buildQuota(snapshot, { timestamp: snapshot.timestamp, dailyLimit: config.dailyLimit, windowHours: config.windowHours });
    snapshot.status = { ...snapshot.status, resetAt: snapshot.quota.primary.resetAt, resetInMs: snapshot.quota.primary.resetInMs, remaining: snapshot.quota.primary.remaining };
  } catch {}
  try { snapshot.health = buildHealth(snapshot, config); } catch { snapshot.health = { issues: [] }; }
  return snapshot;
}

async function getExtensionSummary(options = {}) {
  const config = extensionConfig(options);
  const timestamp = Date.now();
  const summary = await localProvider.getSummary({ ...config, timestamp });
  if (!summary?.ok || !summary.usage) throw new Error(summary?.error || '无法读取 CodeArts 使用摘要');
  return applyDerived({
    ok: true,
    timestamp,
    updatedAt: fmtTime(timestamp),
    adapter: summary.perf?.aggregate?.adapter || '',
    dbPath: localProvider.resolveDbPath(config),
    sources: summary.sources || [],
    sourceStats: [],
    usage: summary.usage,
    trends: { hourly24h: [], daily14d: [] },
    models: [],
    sessions: [],
    capabilities: extensionCapabilities(),
    performance: emptyPerformance(),
    queue: { window: {} },
    tools: { window: { byName: [] } },
    dbSize: sourceBytes(summary.sources),
    summaryOnly: true,
    aggregatePending: true,
    freshness: { stale: false, source: 'summary', ageMs: 0 },
    completeness: extensionCompleteness(summary),
    perf: summary.perf || {},
  }, config);
}

function sessionView(item = {}, timestamp = Date.now()) {
  return {
    id: item.id || '',
    title: redactSensitiveText(item.title || '未命名会话'),
    directory: redactSensitiveText(item.directory || ''),
    source: item.source || '',
    sourceLabel: item.sourceLabel || item.source || '',
    age: Number.isFinite(Number(item.age)) ? Number(item.age) : Math.max(0, timestamp - Number(item.updatedAt || timestamp)),
    archived: Boolean(item.archived),
    usage: item.usage || {},
  };
}

async function getExtensionDetails(options = {}) {
  const config = extensionConfig(options);
  const timestamp = Date.now();
  const selectedRange = extensionRange(options, timestamp);
  const scope = { source: options.source ?? 'all', model: options.model ?? 'all', project: options.project ?? 'all' };
  const rangePayload = { start: selectedRange.start, endExclusive: selectedRange.endExclusive };
  const filterScope = { ...config, source: 'all', model: 'all', project: 'all', timestamp };
  const [currentSummary, aggregates, sessionsPage, requestsPage, databaseHealth, filterOptions] = await Promise.all([
    localProvider.getSummary(currentUsageOptions(config, timestamp)),
    localProvider.getDashboardAggregates({ ...config, ...scope, timestamp, range: rangePayload, bucketMs: selectedRange.bucketMs, disableUsageRollup: true }),
    localProvider.getSessionsPage({ ...config, limit: 12, offset: 0, ...scope, status: 'active', range: rangePayload }),
    localProvider.getRequestsPage({ ...config, ...scope, limit: 40, offset: 0, range: rangePayload }),
    localProvider.getDatabaseHealth({ ...config, source: scope.source, timestamp }),
    Promise.all([
      localProvider.getModelStats(filterScope),
      localProvider.getSessionSummary(filterScope),
    ]),
  ]);
  const [filterModels, filterProjects] = filterOptions;
  const filterOptionsComplete = [currentSummary, filterModels, filterProjects]
    .every((result) => result?.ok && !(result.sourceErrors || []).length);
  if (!currentSummary?.ok || !currentSummary.usage) throw new Error(currentSummary?.error || '无法读取当前 CodeArts 使用摘要');
  if (!aggregates?.ok) throw new Error(aggregates?.error || '无法读取 CodeArts 聚合数据');
  const currentUsage = currentSummary.usage;
  const rangeUsage = aggregates.buckets?.length ? usageFromBuckets(aggregates.buckets) : scopedUsage(aggregates.sourceStats || []);
  const providers = providerStatsFromModels(aggregates.modelStats || []);
  const rangePerformance = aggregates.performance || performanceFromBuckets(aggregates.buckets || [], rangeUsage);
  const sessions = (sessionsPage?.items || []).map((item) => sessionView(item, timestamp));
  const requests = (requestsPage?.items || []).map((item) => ({
    id: item.id || '', time: item.time || item.createdAt || 0,
    sessionTitle: safeIdeText(item.sessionTitle || '未命名会话', 500),
    source: item.source || '', sourceLabel: item.sourceLabel || item.source || '',
    provider: item.provider || '', model: item.model || '', status: item.status,
    ok: item.ok !== false, total: Number(item.total || 0), input: Number(item.input || 0), output: Number(item.output || 0),
    reasoning: Number(item.reasoning || 0), cacheRead: Number(item.cacheRead || 0), cacheWrite: Number(item.cacheWrite || 0), latencyMs: item.latencyMs,
    ttftMs: item.ttftMs, firstContentMs: item.firstContentMs, outputTokensPerSec: item.outputTokensPerSec,
    error: safeIdeText(item.error || ''),
  }));
  return applyDerived({
    ok: true,
    timestamp,
    updatedAt: fmtTime(timestamp),
    adapter: aggregates.perf?.aggregate?.adapter || '',
    dbPath: localProvider.resolveDbPath(config),
    sources: aggregates.sources || [],
    filterSources: currentSummary.sources || aggregates.sources || [],
    sourceStats: aggregates.sourceStats || [],
    usage: { ...currentUsage, range: rangeUsage },
    trends: { hourly24h: selectedRange.bucketMs === HOUR_MS ? aggregates.buckets || [] : [], daily14d: selectedRange.bucketMs === DAY_MS ? aggregates.buckets || [] : [], range: aggregates.buckets || [] },
    models: aggregates.modelStats || [],
    filterModels: filterModels?.items || aggregates.modelStats || [],
    filterOptionsComplete,
    providerStats: providers,
    sessions,
    sessionTotal: Number(sessionsPage?.total || sessions.length),
    sessionTotalExact: true,
    requests,
    requestTotal: Number(requestsPage?.total || requests.length),
    historicalRequestTotal: Number(requestsPage?.total || requests.length),
    requestLogComplete: Number(requestsPage?.total || requests.length) <= requests.length,
    requestLogSampled: Number(requestsPage?.total || requests.length) > requests.length,
    requestLogSampleLimit: requests.length,
    capabilities: extensionCapabilities(),
    performance: { window: rangePerformance },
    queue: { window: {} },
    tools: { window: { byName: [] } },
    dbSize: sourceBytes(aggregates.sources),
    summaryOnly: false,
    aggregatePending: false,
    freshness: { stale: false, source: 'aggregates', ageMs: 0 },
    selectedRange,
    selectedScope: scope,
    projects: (aggregates.sessionSummary?.projects || []).map((item) => ({
      id: item.key || item.directory || '__none',
      label: item.directory ? path.basename(item.directory) || item.directory : '未关联项目',
      directory: item.directory || '', count: Number(item.count || 0),
    })),
    filterProjects: (filterProjects?.projects || aggregates.sessionSummary?.projects || []).map((item) => ({
      id: item.key || item.directory || '__none',
      label: item.directory ? path.basename(item.directory) || item.directory : '未关联项目',
      directory: item.directory || '', count: Number(item.count || 0),
    })),
    diagnostics: {
      items: (databaseHealth?.items || []).map((item) => ({
        source: item.source || '', label: item.label || item.source || '', ok: item.ok !== false,
        quickCheck: item.quickCheck || '', tables: (item.tables || []).length,
        messages: Number(item.messageCount || 0), sessions: Number(item.sessionCount || 0),
      })),
      sourceErrors: (databaseHealth?.sourceErrors || []).map((item) => ({ source: item.source || '', message: safeIdeText(item.message || item.error || '数据库检查失败') })),
    },
    sourceErrors: (aggregates.sourceErrors || []).map((item) => ({ source: item.source || item.id || '', message: safeIdeText(item.message || item.error || '数据源读取失败') })),
    completeness: extensionCompleteness(aggregates, rangePerformance),
    perf: { range: aggregates.perf || {} },
  }, config);
}

module.exports = { extensionConfig, extensionRange, getExtensionSummary, getExtensionDetails, scopedUsage, sessionView, extensionCompleteness };
