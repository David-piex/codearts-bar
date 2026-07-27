'use strict';

function createQueryService(options = {}) {
  const provider = options.provider || {};
  const normalizeAggregatePayload = typeof options.normalizeAggregatePayload === 'function'
    ? options.normalizeAggregatePayload
    : (payload) => payload || {};
  const fallback = typeof options.fallback === 'function' ? options.fallback : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;

  async function invoke(method, payload = {}, scope = method, normalize = false) {
    try {
      const handler = provider[method];
      if (typeof handler !== 'function') throw new Error(`Query provider does not implement ${method}`);
      return await handler(normalize ? normalizeAggregatePayload(payload) : payload);
    } catch (error) {
      onError?.({ method, scope, payload, error });
      const recovered = fallback ? await fallback(scope, payload, error) : null;
      if (recovered != null) return recovered;
      throw error;
    }
  }

  return {
    getSummary: (payload) => invoke('getSummary', payload, 'summary', true),
    getTrend: (payload) => invoke('getTrendBuckets', payload, 'trend', true),
    getModels: (payload) => invoke('getModelStats', payload, 'model', true),
    getSources: (payload) => invoke('getSourceStats', payload, 'source', true),
    getSessionSummary: (payload) => invoke('getSessionSummary', payload, 'session', true),
    getAggregates: (payload) => invoke('getDashboardAggregates', payload, 'aggregates', true),
    getDatabaseHealth: (payload) => invoke('getDatabaseHealth', payload, 'databaseHealth', true),
    getSessionsPage: (payload) => invoke('getSessionsPage', payload, 'sessions'),
    getRequestsPage: (payload) => invoke('getRequestsPage', payload, 'requests'),
    getSessionRequestsPage: (payload) => invoke('getSessionRequestsPage', payload, 'sessionRequests'),
  };
}

module.exports = { createQueryService };
