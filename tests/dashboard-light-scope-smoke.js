'use strict';

const assert = require('node:assert/strict');
const localProvider = require('../src/providers/codeartsLocal');
const {
  buildDashboardLightPair,
  dashboardAggregatePayload,
  defaultRequestPagePayload,
  defaultSessionPagePayload,
  matchesPageFilters,
  usageScopeKeyForPayload,
  applyUsageDerivedFields,
} = require('../src/main/dashboard-light');

async function main(){
  const oldStart = Date.UTC(2026, 5, 13, 2, 42);
  const oldEnd = Date.UTC(2026, 6, 13, 2, 42);
  const halfOpenPayload = { range: { start: oldStart, endExclusive: oldEnd } };
  const canonicalPayload = dashboardAggregatePayload({ timestamp: oldEnd });
  assert.equal(Object.prototype.hasOwnProperty.call(canonicalPayload, 'end'), false, 'canonical aggregate must let the data layer apply timestamp as its real-now cutoff');
  const boundedPayload = dashboardAggregatePayload({ timestamp: oldEnd, range: { start: oldStart, endExclusive: oldEnd } });
  assert.equal(boundedPayload.endExclusive, oldEnd);
  assert.equal(boundedPayload.range.end, oldEnd);
  assert.equal(matchesPageFilters({ time: oldStart }, halfOpenPayload), true, 'start must be inclusive');
  assert.equal(matchesPageFilters({ time: oldEnd - 1 }, halfOpenPayload), true, 'value before endExclusive must be included');
  assert.equal(matchesPageFilters({ time: oldEnd }, halfOpenPayload), false, 'endExclusive must be excluded');
  assert.notEqual(
    usageScopeKeyForPayload({ rangeKey: 'customTime', start: oldStart, endExclusive: oldEnd }),
    usageScopeKeyForPayload({ rangeKey: 'customTime', start: oldStart + 1, endExclusive: oldEnd }),
    'custom range bounds must be part of the scope identity'
  );
  const splitSearchPayload = { query: 'request-only', sessionQuery: '' };
  assert.equal(defaultRequestPagePayload(splitSearchPayload).query, 'request-only');
  assert.equal(defaultSessionPagePayload(splitSearchPayload).query, '', 'analytics query must not filter session pagination');
  assert.equal(defaultSessionPagePayload({ ...splitSearchPayload, sessionQuery: 'session-only' }).query, 'session-only');

  const canonical = {
    ok: true,
    timestamp: oldEnd + 86400000,
    usageScope: { source: 'all', model: 'all', rangeKey: '', start: 0, endExclusive: 0 },
    queryScope: { source: 'all', model: 'all', rangeKey: '', start: 0, endExclusive: 0 },
    usage: { today: { total: 8800 }, window: { total: 9900 }, week: { total: 12000 }, all: { total: 30000 } },
    config: { dailyLimit: 10000, windowHours: 24 },
  };
  const filtered = {
    ok: true,
    timestamp: oldEnd,
    usageScope: { source: 'cli', model: 'gpt-5', rangeKey: '30d', start: oldStart, endExclusive: oldEnd },
    usage: { today: { total: 1 }, window: { total: 2 }, week: { total: 3 }, all: { total: 4 } },
  };
  applyUsageDerivedFields(filtered, { dailyLimit: 10000, windowHours: 24 }, filtered.timestamp, { canonicalSnapshot: canonical });
  assert.equal(filtered.quota.primary.used, 8800, 'filtered scope must keep canonical daily quota');
  assert.equal(filtered.status.usagePercent, 88, 'filtered scope must keep canonical status percentage');
  assert.equal(filtered.quota.primary.resetAt, new Date(filtered.timestamp).setHours(24, 0, 0, 0));
  const originals = {
    getDashboardAggregates: localProvider.getDashboardAggregates,
    getRequestsPage: localProvider.getRequestsPage,
    getSessionsPage: localProvider.getSessionsPage,
  };
  try {
    localProvider.getDashboardAggregates = async () => ({
      ok: true,
      usage: { all: { total: 15272301, requests: 166 } },
      buckets: [],
      sourceStats: [],
      modelStats: [],
      sessionSummary: { total: 0, active: 0, archived: 0, visible: 0 },
    });
    localProvider.getRequestsPage = async () => ({ ok: true, items: [], total: 0, limit: 100, offset: 0 });
    localProvider.getSessionsPage = async () => ({ ok: true, items: [], total: 0, limit: 50, offset: 0 });

    const oldSummary = {
      ok: true,
      timestamp: oldEnd,
      usage: { all: { total: 35394225, requests: 407 } },
      usageScope: { source: 'all', model: 'all', rangeKey: 'customTime', start: oldStart, end: oldEnd },
      summaryOnly: true,
      summaryFilter: { source: 'all', model: 'all', rangeKey: 'customTime', start: oldStart, end: oldEnd },
    };
    const timestamp = oldEnd + 1000;
    const { fullSnap, dashboardSnap } = await buildDashboardLightPair(oldSummary, { reason: 'watch', timestamp }, canonical);

    for(const snap of [fullSnap, dashboardSnap]){
      assert.equal(snap.usage.all.total, 15272301);
      assert.equal(snap.summaryOnly, false);
      assert.equal(snap.summaryFilter, null);
      assert.deepEqual(snap.queryScope, { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0 });
      assert.deepEqual(snap.usageScope, { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0 });
      assert.deepEqual(snap.sourceStatsScope, { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0, complete: true });
      assert.deepEqual(snap.modelsScope, { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0, complete: true });
    }
  } finally {
    Object.assign(localProvider, originals);
  }

  try {
    localProvider.getDashboardAggregates = async () => ({
      ok: true,
      usage: { all: { total: 15272301, requests: 166 } },
      buckets: [{ start: oldStart, total: 15272301, requests: 166 }],
      sourceStats: [{ source: 'cli', total: 15272301 }],
      modelStats: [],
      sessionSummary: { total: 0, active: 0, archived: 0, visible: 0 },
      sourceErrors: [{ source: 'desktop', message: 'database is locked' }],
    });
    localProvider.getRequestsPage = async () => ({ ok: true, items: [], total: 0, limit: 100, offset: 0 });
    localProvider.getSessionsPage = async () => ({ ok: true, items: [], total: 0, limit: 50, offset: 0 });

    const fullBase = {
      ok: true,
      timestamp: oldEnd,
      usage: { all: { total: 35394225, requests: 407 } },
      usageScope: { source: 'cli', model: 'gpt-5', rangeKey: '30d', start: oldStart, endExclusive: oldEnd },
      sourceStats: [{ source: 'desktop', total: 35394225 }],
    };
    const result = await buildDashboardLightPair(fullBase, { source: 'cli', model: 'gpt-5', rangeKey: '30d', range: { start: oldStart, endExclusive: oldEnd }, timestamp: oldEnd }, canonical);
    for (const snap of [result.fullSnap, result.dashboardSnap]) {
      assert.equal(snap.usage.all.total, 35394225, 'partial source aggregate must not replace complete usage');
      assert.deepEqual(snap.sourceStats, fullBase.sourceStats);
      assert.equal(snap.sourceErrors[0].message, 'database is locked');
      assert.equal(snap.quota.primary.used, canonical.usage.today.total, 'sourceErrors fallback must keep canonical quota');
      assert.equal(snap.status.usagePercent, snap.quota.primary.percent, 'sourceErrors fallback must keep canonical status');
    }
  } finally {
    Object.assign(localProvider, originals);
  }
  console.log('ok - dashboard light scope smoke');
}

main().catch((error) => { console.error(error); process.exit(1); });
