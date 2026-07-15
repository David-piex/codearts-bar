'use strict';
const { envelope, failure } = require('./envelope');
const { databasePagePayload, usageFromBuckets, analyticsPayload } = require('./query-results');

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function page(items, options = {}) {
  const pageSize = Math.max(1, Math.min(500, Math.trunc(finite(options.pageSize, 50))));
  const pageNumber = Math.max(1, Math.trunc(finite(options.page, 1)));
  const start = (pageNumber - 1) * pageSize;
  const rows = items || [];
  const paged = rows.slice(start, start + pageSize);
  return { items: paged, page: pageNumber, pageSize, total: rows.length, pageCount: Math.max(1, Math.ceil(rows.length / pageSize)), hasMore: start + paged.length < rows.length };
}
function searchableSessions(items, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return items || [];
  return (items || []).filter((item) => [item?.id, item?.title, item?.directory, item?.sourceLabel, item?.source, item?.usage?.topModel?.model]
    .some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
}
function analyticsResult(s = {}) {
  return {
    ...s,
    buckets: Array.isArray(s.buckets) ? s.buckets : Array.isArray(s.trend) ? s.trend : s.trends?.hourly24h || [],
    modelStats: Array.isArray(s.modelStats) ? s.modelStats : s.models || [],
    sourceStats: Array.isArray(s.sourceStats) ? s.sourceStats : s.sources || [],
  };
}
function dashboardData(s = {}) {
  const requests = Array.isArray(s.requestLog) ? s.requestLog : [];
  const historicalRequestTotal = finite(s.requestTotal, requests.length);
  return {
    updatedAt: s.updatedAt || '', dbSize: finite(s.dbSize), adapter: s.adapter || '', config: s.config || {}, status: s.status || {}, usage: s.usage || {},
    trends: s.trends || { hourly24h: [], daily14d: [] }, models: s.models || [], modelsScope: s.modelsScope || null, sources: s.sourceStats || s.sources || [],
    sessions: (s.sessions || []).filter((x) => !x.archived), sessionSummary: s.sessionSummary || {}, requests,
    requestTotal: requests.length, historicalRequestTotal,
    requestLogComplete: s.requestLogComplete === true || historicalRequestTotal <= requests.length,
    requestLogSampled: s.requestLogSampled === true || historicalRequestTotal > requests.length,
    requestLogSampleLimit: finite(s.requestLogSampleLimit, requests.length), sourceStatsScope: s.sourceStatsScope || null,
    providerStats: s.providerStats || [], providerStatsScope: s.providerStatsScope || null, performance: s.performance || {}, queue: s.queue || {}, tools: s.tools || {},
    health: s.health || {}, quota: s.quota || {}, freshness: s.freshness || {}, providers: s.providers || [], process: s.process || {},
  };
}
function queryPayload(snapshot, resource = 'dashboard', options = {}) {
  if (!snapshot?.ok) return failure(snapshot?.error || 'Unable to read local usage data.', options);
  if (resource === 'analytics' || resource === 'filters') {
    const payload = analyticsPayload(analyticsResult(snapshot), { ...options, generatedAt: finite(snapshot.timestamp, Date.now()) });
    if (resource === 'analytics') return payload;
    return { ...payload, data: { models: payload.data.models, projects: payload.data.projects } };
  }
  const all = dashboardData(snapshot); let data;
  switch (resource) {
    case 'summary': data = { updatedAt: all.updatedAt, adapter: all.adapter, status: all.status, usage: all.usage, config: all.config, health: all.health, quota: all.quota, freshness: all.freshness }; break;
    case 'trend': data = all.trends; break;
    case 'models': data = { items: all.models, scope: all.modelsScope }; break;
    case 'sources': data = { items: all.sources, scope: all.sourceStatsScope }; break;
    case 'sessions': data = page(searchableSessions(all.sessions, options.query), options); break;
    case 'requests': {
      const rows = options.sessionId ? all.requests.filter((x) => x.sessionId === options.sessionId) : all.requests;
      data = { ...page(rows, options), historicalRequestTotal: options.sessionId ? null : all.historicalRequestTotal, requestLogComplete: all.requestLogComplete, requestLogSampled: all.requestLogSampled, requestLogSampleLimit: all.requestLogSampleLimit };
      break;
    }
    case 'diagnostics': data = { updatedAt: all.updatedAt, dbSize: all.dbSize, adapter: all.adapter, performance: all.performance, queue: all.queue, tools: all.tools, health: all.health, quota: all.quota, freshness: all.freshness, providers: all.providers, process: all.process }; break;
    case 'dashboard': data = all; break;
    default: return failure(`Unknown query resource: ${resource}`, options);
  }
  return envelope(data, { ...options, generatedAt: finite(snapshot.timestamp, Date.now()), diagnostics: { adapter: all.adapter, cache: snapshot.freshness?.source || null } });
}
module.exports = { queryPayload, dashboardData, page, searchableSessions, analyticsResult, databasePagePayload, usageFromBuckets, analyticsPayload };
