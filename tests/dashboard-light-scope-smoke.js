'use strict';

const assert = require('node:assert/strict');
const localProvider = require('../src/providers/codeartsLocal');
const { buildDashboardLightPair, dashboardAggregatePayload, matchesPageFilters, usageScopeKeyForPayload } = require('../src/main/dashboard-light');

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
    const { fullSnap, dashboardSnap } = await buildDashboardLightPair(oldSummary, { reason: 'watch', timestamp });

    for(const snap of [fullSnap, dashboardSnap]){
      assert.equal(snap.usage.all.total, 15272301);
      assert.equal(snap.summaryOnly, false);
      assert.equal(snap.summaryFilter, null);
      assert.deepEqual(snap.queryScope, { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0 });
      assert.deepEqual(snap.usageScope, { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0, endExclusive: 0 });
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
      usageScope: { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0 },
      sourceStats: [{ source: 'desktop', total: 35394225 }],
    };
    const result = await buildDashboardLightPair(fullBase, { timestamp: oldEnd });
    for (const snap of [result.fullSnap, result.dashboardSnap]) {
      assert.equal(snap.usage.all.total, 35394225, 'partial source aggregate must not replace complete usage');
      assert.deepEqual(snap.sourceStats, fullBase.sourceStats);
      assert.equal(snap.sourceErrors[0].message, 'database is locked');
    }
  } finally {
    Object.assign(localProvider, originals);
  }
  console.log('ok - dashboard light scope smoke');
}

main().catch((error) => { console.error(error); process.exit(1); });
