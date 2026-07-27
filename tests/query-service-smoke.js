'use strict';

const assert = require('node:assert/strict');
const { createQueryService } = require('../src/query-service');

async function main() {
  const calls = [];
  const provider = {
    getSummary: async (payload) => ({ ok: true, payload }),
    getTrendBuckets: async (payload) => ({ ok: true, payload }),
    getModelStats: async (payload) => ({ ok: true, payload }),
    getSourceStats: async (payload) => ({ ok: true, payload }),
    getSessionSummary: async (payload) => ({ ok: true, payload }),
    getDashboardAggregates: async (payload) => ({ ok: true, payload }),
    getDatabaseHealth: async (payload) => ({ ok: true, payload }),
    getSessionsPage: async (payload) => ({ ok: true, payload }),
    getRequestsPage: async (payload) => ({ ok: true, payload }),
    getSessionRequestsPage: async (payload) => ({ ok: true, payload }),
  };
  for (const [name, handler] of Object.entries(provider)) {
    provider[name] = async (payload) => { calls.push({ name, payload }); return handler(payload); };
  }
  const service = createQueryService({
    provider,
    normalizeAggregatePayload: (payload) => ({ ...payload, normalized: true }),
  });
  assert.equal((await service.getSummary({ source: 'all' })).payload.normalized, true);
  assert.equal((await service.getTrend({ source: 'cli' })).payload.normalized, true);
  assert.equal((await service.getModels({ model: 'm' })).payload.normalized, true);
  assert.equal((await service.getSources({ source: 'desktop' })).payload.normalized, true);
  assert.equal((await service.getSessionSummary({ query: 'q' })).payload.normalized, true);
  assert.equal((await service.getAggregates({ range: { start: 1 } })).payload.normalized, true);
  assert.equal((await service.getDatabaseHealth({ source: 'all' })).payload.normalized, true);
  const cursor = 'opaque-cursor';
  assert.equal((await service.getRequestsPage({ cursor })).payload.cursor, cursor);
  assert.equal((await service.getSessionsPage({ cursor })).payload.cursor, cursor);
  assert.equal((await service.getSessionRequestsPage({ sessionId: 's', cursor })).payload.cursor, cursor);
  assert.equal(calls.length, 10);

  const errors = [];
  const fallbackService = createQueryService({
    provider: { getSummary: async () => { throw new Error('failed'); } },
    onError: (entry) => errors.push(entry),
    fallback: (scope) => scope === 'summary' ? { ok: true, fallback: 'snapshot' } : null,
  });
  assert.equal((await fallbackService.getSummary({})).fallback, 'snapshot');
  assert.equal(errors[0].method, 'getSummary');

  console.log('ok - unified query service method mapping normalization cursor and fallback');
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { main };
