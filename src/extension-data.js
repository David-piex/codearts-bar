'use strict';

const { loadSettings } = require('./settings');
const { buildQuota } = require('./quota');
const { buildHealth } = require('./health');
const localProvider = require('./providers/codeartsLocal');
const { fmtTime } = require('./core/format');

function extensionConfig(options = {}) {
  const settings = loadSettings();
  return {
    ...settings,
    ...options,
    dailyLimit: Number(options.dailyLimit || settings.dailyLimit || 200000),
    windowHours: Number(options.windowHours || settings.windowHours || 24),
  };
}

function emptyPerformance() {
  return { window: { latency: {}, ttft: {}, firstContentApprox: {}, outputTokensPerSec: {}, errorRate: 0 } };
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
    performance: emptyPerformance(),
    queue: { window: {} },
    tools: { window: { byName: [] } },
    dbSize: (summary.sources || []).reduce((sum, source) => sum + Number(source.size || 0), 0),
    summaryOnly: true,
    aggregatePending: true,
    freshness: { stale: false, source: 'summary', ageMs: 0 },
    perf: summary.perf || {},
  }, config);
}

function sessionView(item = {}, timestamp = Date.now()) {
  return {
    id: item.id || '',
    title: item.title || '未命名会话',
    directory: item.directory || '',
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
  const hourStart = timestamp - 24 * 3600000;
  const dayStart = timestamp - 14 * 86400000;
  const [hourly, daily, sessionsPage] = await Promise.all([
    localProvider.getDashboardAggregates({ ...config, timestamp, range: { start: hourStart, end: timestamp }, bucketMs: 3600000 }),
    localProvider.getDashboardAggregates({ ...config, timestamp, range: { start: dayStart, end: timestamp }, bucketMs: 86400000 }),
    localProvider.getSessionsPage({ ...config, limit: 8, offset: 0, source: 'all', status: 'active' }),
  ]);
  const primary = daily?.ok ? daily : hourly;
  if (!primary?.ok) throw new Error(primary?.error || hourly?.error || '无法读取 CodeArts 聚合数据');
  return applyDerived({
    ok: true,
    timestamp,
    updatedAt: fmtTime(timestamp),
    adapter: primary.perf?.aggregate?.adapter || '',
    dbPath: localProvider.resolveDbPath(config),
    sources: primary.sources || [],
    sourceStats: primary.sourceStats || [],
    usage: primary.usage || hourly.usage || {},
    trends: { hourly24h: hourly?.buckets || [], daily14d: daily?.buckets || [] },
    models: (primary.modelStats || []).slice(0, 12),
    sessions: (sessionsPage?.items || []).map((item) => sessionView(item, timestamp)),
    performance: emptyPerformance(),
    queue: { window: {} },
    tools: { window: { byName: [] } },
    dbSize: (primary.sources || []).reduce((sum, source) => sum + Number(source.size || 0), 0),
    summaryOnly: false,
    aggregatePending: false,
    freshness: { stale: false, source: 'aggregates', ageMs: 0 },
    perf: { hourly: hourly?.perf || {}, daily: daily?.perf || {} },
  }, config);
}

module.exports = { extensionConfig, getExtensionSummary, getExtensionDetails, sessionView };
