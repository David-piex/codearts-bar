'use strict';
const { envelope, failure } = require('./envelope');

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
function databasePagePayload(result = {}, options = {}) {
  const pageSize = Math.max(1, Math.trunc(finite(result.limit, finite(options.pageSize, 50))));
  const offset = Math.max(0, Math.trunc(finite(result.offset, (Math.max(1, Math.trunc(finite(options.page, 1))) - 1) * pageSize)));
  const total = Math.max(0, Math.trunc(finite(result.total, 0)));
  const pageNumber = Math.floor(offset / pageSize) + 1;
  const items = (result.items || []).map((item) => { const { dbPath: _dbPath, ...safe } = item || {}; return safe; });
  return envelope({ items, page: pageNumber, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), hasMore: Boolean(result.hasMore), strategy: result.strategy || 'database' }, { ...options, diagnostics: { adapter: result.nativeError ? 'sql.js' : 'node:sqlite', cache: null } });
}
function dashboardData(s = {}) {
  const requests = Array.isArray(s.requestLog) ? s.requestLog : [];
  const historicalRequestTotal = finite(s.requestTotal, requests.length);
  return {
    updatedAt: s.updatedAt || '', dbPath: s.dbPath || '', dbSize: finite(s.dbSize), adapter: s.adapter || '', config: s.config || {}, status: s.status || {}, usage: s.usage || {},
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
    case 'diagnostics': data = { updatedAt: all.updatedAt, dbPath: all.dbPath, dbSize: all.dbSize, adapter: all.adapter, performance: all.performance, queue: all.queue, tools: all.tools, health: all.health, quota: all.quota, freshness: all.freshness, providers: all.providers, process: all.process }; break;
    case 'dashboard': data = all; break;
    default: return failure(`Unknown query resource: ${resource}`, options);
  }
  return envelope(data, { ...options, generatedAt: finite(snapshot.timestamp, Date.now()), diagnostics: { adapter: all.adapter, cache: snapshot.freshness?.source || null } });
}
module.exports = { queryPayload, dashboardData, page, searchableSessions, databasePagePayload };
