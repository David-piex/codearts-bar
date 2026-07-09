'use strict';

const { buildQuota } = require('../quota');
const { loadSettings } = require('../settings');
const { buildHealth } = require('../health');
const localProvider = require('../providers/codeartsLocal');

const SESSION_PAGE_SIZE = 48;

function usageStatusFromSummary(usage = {}, settings = loadSettings()) {
  const dailyLimit = Number(settings.dailyLimit || process.env.CODEARTS_BAR_DAILY_LIMIT || 200000);
  const today = usage.today || {};
  const usagePercent = dailyLimit > 0 ? Math.min(999, Math.max(0, (Number(today.total || 0) / dailyLimit) * 100)) : 0;
  return { label: `${Math.round(usagePercent)}%`, usagePercent, level: usagePercent >= 90 ? 'danger' : usagePercent >= 70 ? 'warning' : 'ok' };
}

function applyUsageDerivedFields(snap, settings = loadSettings(), timestamp = Number(snap?.timestamp || Date.now())) {
  if (!snap || !snap.ok || !snap.usage) return snap;
  const dailyLimit = Number(settings.dailyLimit || process.env.CODEARTS_BAR_DAILY_LIMIT || 200000);
  const windowHours = Number(settings.windowHours || process.env.CODEARTS_BAR_WINDOW_HOURS || 24);
  snap.config = { ...(snap.config || {}), dailyLimit, windowHours };
  snap.quota = buildQuota(snap, { timestamp, dailyLimit, windowHours });
  snap.status = {
    ...(snap.status || {}),
    ...usageStatusFromSummary(snap.usage, settings),
    resetAt: snap.quota.primary.resetAt,
    resetInMs: snap.quota.primary.resetInMs,
    remaining: snap.quota.primary.remaining,
  };
  snap.health = buildHealth(snap, settings);
  return snap;
}

function dashboardAggregatePayload(payload = {}) {
  const settings = loadSettings();
  return {
    ...payload,
    dailyLimit: Number(payload.dailyLimit || settings.dailyLimit || process.env.CODEARTS_BAR_DAILY_LIMIT || 200000),
    windowHours: Number(payload.windowHours || settings.windowHours || process.env.CODEARTS_BAR_WINDOW_HOURS || 24),
    timestamp: Number(payload.timestamp || Date.now()),
  };
}

function trendScopeKeyForPayload(payload = {}, bucketMs = 3600000) {
  const range = payload.range || {};
  const startRaw = Number(payload.start ?? range.start ?? 0) || 0;
  const endRaw = Number(payload.end ?? range.end ?? payload.timestamp ?? Date.now()) || 0;
  const safeBucketMs = Math.max(1, Number(bucketMs || payload.bucketMs || 3600000));
  const start = startRaw > 0 ? Math.floor(startRaw / safeBucketMs) * safeBucketMs : 0;
  const end = endRaw > 0 ? Math.ceil(endRaw / safeBucketMs) * safeBucketMs : 0;
  return `${payload.source || 'all'}|${payload.model || 'all'}|${safeBucketMs}|${start}|${end}`;
}

function pageBounds(payload = {}) {
  const limit = Math.max(1, Math.min(500, Number(payload.limit || 100)));
  const offset = Math.max(0, Number(payload.offset || 0));
  return { limit, offset };
}

function normalizePageRange(range = {}) {
  const start = Number(range.start || 0);
  const end = Number(range.end || 0);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    end: Number.isFinite(end) && end > 0 ? end : 0,
  };
}

function matchesPageFilters(item, payload = {}) {
  if (!item) return false;
  if (payload.source && payload.source !== 'all' && String(item.source || '') !== String(payload.source)) return false;
  const { start, end } = normalizePageRange(payload.range);
  const time = Number(item.time || item.updatedAt || item.createdAt || 0);
  if (start && time && time < start) return false;
  if (end && time && time > end) return false;
  const query = String(payload.query || '').trim().toLowerCase();
  if (query) {
    const text = [
      item.id,
      item.sessionId,
      item.sessionTitle,
      item.title,
      item.directory,
      item.provider,
      item.model,
      item.sourceLabel,
      item.source,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

function defaultRequestPagePayload(payload = {}) {
  return {
    limit: 100,
    offset: 0,
    source: payload.source || 'all',
    model: payload.model || 'all',
    range: payload.range || {},
    query: payload.query || '',
  };
}

function defaultSessionPagePayload(payload = {}) {
  return {
    limit: SESSION_PAGE_SIZE,
    offset: 0,
    source: payload.source || 'all',
    status: payload.status || 'active',
    project: payload.project || 'all',
    range: payload.range || {},
    query: payload.sessionQuery || payload.query || '',
  };
}

function pageEnvelope(page = {}, payload = {}, fallbackItems = [], fallbackTotal = 0) {
  const items = Array.isArray(page.items) ? page.items : fallbackItems;
  const total = Number(page.total ?? fallbackTotal ?? items.length);
  const limit = Number(page.limit || payload.limit || items.length || 1);
  const offset = Number(page.offset || payload.offset || 0);
  return {
    limit,
    offset,
    total,
    hasMore: Boolean(page.hasMore ?? (offset + items.length < total)),
    items,
    payload,
    snapshotTimestamp: Number(page.snapshotTimestamp || Date.now()),
  };
}

function buildDashboardPreviewSnapshot(full, payload = {}) {
  if (!full || !full.ok) return full;
  const requestPayload = defaultRequestPagePayload(payload);
  const sessionPayload = defaultSessionPagePayload(payload);
  const requestItems = ((full.requestLog || []).filter((item) => matchesPageFilters(item, requestPayload))).slice(0, requestPayload.limit);
  const sessionItems = ((full.sessions || []).filter((item) => matchesPageFilters(item, sessionPayload))).slice(0, sessionPayload.limit);
  const requestTotal = Number(full.requestTotal || (full.requestLog || []).length || requestItems.length);
  const sessionTotal = Number(full.sessionTotal || full.sessionSummary?.active || full.sessionSummary?.total || (full.sessions || []).length || sessionItems.length);
  return {
    ...full,
    requestLog: requestItems,
    sessions: sessionItems,
    requestTotal,
    sessionTotal,
    requestPage: pageEnvelope({}, requestPayload, requestItems, requestTotal),
    sessionPage: pageEnvelope({}, sessionPayload, sessionItems, sessionTotal),
    lightRefresh: true,
    freshness: { ...(full.freshness || {}), source: full.freshness?.source || 'preview' },
  };
}

function lightUpdatedAt(ts = Date.now()) {
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
  catch { return String(ts); }
}

function makeLightSnapshotFromAggregates(aggregates = {}, payload = {}) {
  const settings = loadSettings();
  const timestamp = Number(payload.timestamp || aggregates.timestamp || Date.now());
  const usage = aggregates.usage || { today: {}, window: {}, week: {}, all: {} };
  const bucketMs = Number(aggregates.bucketMs || payload.bucketMs || 3600000);
  const snap = {
    ok: true,
    app: '码道 Bar',
    timestamp,
    updatedAt: lightUpdatedAt(timestamp),
    dbPath: localProvider.resolveDbPath ? localProvider.resolveDbPath(settings) : '',
    sources: aggregates.sources || [],
    usage,
    status: usageStatusFromSummary(usage, settings),
    models: Array.isArray(aggregates.modelStats) ? aggregates.modelStats.slice(0, 12) : [],
    sourceStats: Array.isArray(aggregates.sourceStats) ? aggregates.sourceStats : [],
    trends: {},
    trendsSource: 'db-light',
    sessionSummary: aggregates.sessionSummary || { total: 0, active: 0, archived: 0, visible: 0 },
    requestLog: [],
    sessions: [],
    requestTotal: 0,
    sessionTotal: 0,
    performance: { window: { samples: 0, errorRate: 0, ttft: {}, latency: {} } },
    queue: { events: 0, trends: { hourly24h: [] } },
    tools: {},
    errors: [],
    freshness: { stale: false, source: 'aggregate', ageMs: 0 },
    lightRefresh: true,
  };
  if (Array.isArray(aggregates.buckets)) {
    if (bucketMs >= 86400000) snap.trends.daily14d = aggregates.buckets;
    else snap.trends.hourly24h = aggregates.buckets;
    snap.trendsScope = trendScopeKeyForPayload({ ...payload, timestamp }, bucketMs);
    snap.aggregateScope = snap.trendsScope;
    snap.aggregateAt = timestamp;
  }
  if (aggregates.sourceErrors?.length) snap.sourceErrors = aggregates.sourceErrors;
  if (aggregates.nativeError) snap.nativeError = aggregates.nativeError;
  return applyUsageDerivedFields(snap, settings, timestamp);
}

async function buildInitialLightSnapshot(payload = {}) {
  const timestamp = Number(payload.timestamp || Date.now());
  const basePayload = dashboardAggregatePayload({ ...payload, timestamp });
  const bucketMs = Number(basePayload.bucketMs || 3600000);
  const requestPayload = defaultRequestPagePayload(payload);
  const sessionPayload = defaultSessionPagePayload(payload);
  const [aggregates, requestsPage, sessionsPage] = await Promise.all([
    localProvider.getDashboardAggregates(basePayload).catch((error) => ({ ok: false, error: error.message })),
    localProvider.getRequestsPage(requestPayload).catch((error) => ({ ok: false, error: error.message })),
    localProvider.getSessionsPage(sessionPayload).catch((error) => ({ ok: false, error: error.message })),
  ]);
  if (!aggregates?.ok) throw new Error(aggregates?.error || '无法读取 CodeArts 聚合数据');
  const snap = makeLightSnapshotFromAggregates(aggregates, { ...basePayload, bucketMs });
  snap.requestLog = requestsPage?.ok && Array.isArray(requestsPage.items) ? requestsPage.items : [];
  snap.sessions = sessionsPage?.ok && Array.isArray(sessionsPage.items) ? sessionsPage.items : [];
  snap.requestTotal = Number(requestsPage?.total || 0);
  snap.sessionTotal = Number(sessionsPage?.total || 0);
  snap.requestPage = requestsPage?.ok ? pageEnvelope(requestsPage, requestPayload, requestsPage.items || [], requestsPage.total || 0) : null;
  snap.sessionPage = sessionsPage?.ok ? pageEnvelope(sessionsPage, sessionPayload, sessionsPage.items || [], sessionsPage.total || 0) : null;
  return snap;
}

async function buildDashboardLightPair(fullBase, payload = {}) {
  const timestamp = Number(payload.timestamp || Date.now());
  const basePayload = dashboardAggregatePayload({ ...payload, timestamp });
  const dayMode = Number(basePayload.bucketMs || 3600000) >= 86400000;
  const requestPayload = defaultRequestPagePayload(payload);
  const sessionPayload = defaultSessionPagePayload(payload);
  const [aggregates, requestsPage, sessionsPage] = await Promise.all([
    localProvider.getDashboardAggregates(basePayload).catch((error) => ({ ok: false, error: error.message })),
    localProvider.getRequestsPage(requestPayload).catch((error) => ({ ok: false, error: error.message })),
    localProvider.getSessionsPage(sessionPayload).catch((error) => ({ ok: false, error: error.message })),
  ]);
  const settings = loadSettings();
  const fullSnap = {
    ...fullBase,
    timestamp,
    updatedAt: lightUpdatedAt(timestamp),
    freshness: { stale: false, source: 'light', ageMs: 0 },
  };
  if (aggregates?.ok && aggregates.usage) {
    fullSnap.usage = aggregates.usage;
    fullSnap.status = { ...(fullSnap.status || {}), ...usageStatusFromSummary(aggregates.usage, settings) };
  }
  if (aggregates?.ok && Array.isArray(aggregates.buckets)) {
    fullSnap.trends = { ...(fullSnap.trends || {}) };
    if (dayMode) fullSnap.trends.daily14d = aggregates.buckets;
    else fullSnap.trends.hourly24h = aggregates.buckets;
    fullSnap.trendsSource = 'db-light';
    fullSnap.trendsScope = trendScopeKeyForPayload(basePayload, dayMode ? 86400000 : 3600000);
    fullSnap.aggregateScope = fullSnap.trendsScope;
    fullSnap.aggregateAt = timestamp;
  }
  if (aggregates?.ok && Array.isArray(aggregates.sourceStats)) fullSnap.sourceStats = aggregates.sourceStats;
  if (aggregates?.ok && Array.isArray(aggregates.modelStats)) fullSnap.models = aggregates.modelStats.slice(0, 12);
  if (aggregates?.ok && aggregates.sessionSummary) fullSnap.sessionSummary = aggregates.sessionSummary;
  if (aggregates?.sourceErrors) fullSnap.sourceErrors = aggregates.sourceErrors;
  if (aggregates?.nativeError) fullSnap.nativeError = aggregates.nativeError;
  delete fullSnap.lightRefresh;
  applyUsageDerivedFields(fullSnap, settings, timestamp);
  const dashboardSnap = {
    ...fullSnap,
    requestLog: requestsPage?.ok && Array.isArray(requestsPage.items) ? requestsPage.items : [],
    sessions: sessionsPage?.ok && Array.isArray(sessionsPage.items) ? sessionsPage.items : [],
    requestTotal: Number(requestsPage?.total || 0),
    sessionTotal: Number(sessionsPage?.total || 0),
    requestPage: requestsPage?.ok ? pageEnvelope(requestsPage, requestPayload, requestsPage.items || [], requestsPage.total || 0) : null,
    sessionPage: sessionsPage?.ok ? pageEnvelope(sessionsPage, sessionPayload, sessionsPage.items || [], sessionsPage.total || 0) : null,
    lightRefresh: true,
  };
  return { fullSnap, dashboardSnap: applyUsageDerivedFields(dashboardSnap, settings, timestamp) };
}

module.exports = {
  SESSION_PAGE_SIZE,
  usageStatusFromSummary,
  applyUsageDerivedFields,
  dashboardAggregatePayload,
  trendScopeKeyForPayload,
  pageBounds,
  normalizePageRange,
  matchesPageFilters,
  defaultRequestPagePayload,
  defaultSessionPagePayload,
  pageEnvelope,
  buildDashboardPreviewSnapshot,
  lightUpdatedAt,
  makeLightSnapshotFromAggregates,
  buildInitialLightSnapshot,
  buildDashboardLightPair,
};
