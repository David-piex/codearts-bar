'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard', 'dashboard-bootstrap.js'), 'utf8');
const context = { console, Math, Number, String, Object };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'dashboard-bootstrap.js' });

const start = Date.UTC(2026, 5, 13, 2, 42);
const end = Date.UTC(2026, 6, 13, 2, 42);
const payload = {
  source: 'all',
  model: 'all',
  rangeKey: 'customTime',
  range: { start, end },
  start,
  end,
};
const current = {
  ok: true,
  usage: { all: { total: 35394225, requests: 407 } },
  queryScope: { source: 'all', model: 'all', rangeKey: 'customTime', start, end },
  usageScope: { source: 'all', model: 'all', rangeKey: 'customTime', start, end },
  summaryOnly: true,
  summaryFilter: { source: 'all', model: 'all', rangeKey: 'customTime', start, end },
  aggregateScope: 'all|all|86400000|current',
  aggregateAt: end,
  sourceStats: [{ source: 'all', total: 35394225, requests: 407 }],
  requestLog: [{ id: 'range-request' }],
  requestTotal: 407,
  sessionSummary: { total: 66 },
};
const watcher = {
  ok: true,
  lightRefresh: true,
  usage: { all: { total: 15272301, requests: 166 } },
  queryScope: { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0 },
  usageScope: { source: 'all', model: 'all', rangeKey: '', start: 0, end: 0 },
  summaryOnly: false,
  summaryFilter: null,
  aggregateScope: 'all|all|3600000|0|all',
  aggregateAt: end + 1000,
  sourceStats: [{ source: 'all', total: 15272301, requests: 166 }],
  requestLog: [{ id: 'unfiltered-request' }],
  requestTotal: 166,
  sessionSummary: { total: 20 },
};

const guarded = context.protectRealtimeSnapshotScope(current, watcher, payload, current.aggregateScope);
assert.equal(guarded.scopeMismatch, true);
assert.equal(guarded.incoming.usage.all.total, 35394225);
assert.equal(guarded.incoming.usage.all.requests, 407);
assert.equal(guarded.incoming.summaryFilter.rangeKey, 'customTime');
assert.equal(guarded.incoming.queryScope.rangeKey, 'customTime');
assert.equal(guarded.incoming.aggregateScope, current.aggregateScope);
assert.equal(guarded.incoming.requestLog[0].id, 'range-request');
assert.equal(guarded.incoming.requestTotal, 407);
assert.equal(guarded.incoming.sessionSummary.total, 66);

const matching = {
  ...watcher,
  usage: { all: { total: 35400000, requests: 408 } },
  queryScope: { source: 'all', model: 'all', rangeKey: 'customTime', start, end },
  usageScope: { source: 'all', model: 'all', rangeKey: 'customTime', start, end },
  aggregateScope: current.aggregateScope,
};
const accepted = context.protectRealtimeSnapshotScope(current, matching, payload, current.aggregateScope);
assert.equal(accepted.scopeMismatch, false);
assert.equal(accepted.incoming.usage.all.total, 35400000);
assert.equal(accepted.incoming.usage.all.requests, 408);

const otherCustomRange = {
  ...matching,
  queryScope: { ...matching.queryScope, start: start + 86400000 },
  usageScope: { ...matching.usageScope, start: start + 86400000 },
};
const rejectedOtherCustomRange = context.protectRealtimeSnapshotScope(current, otherCustomRange, payload, current.aggregateScope);
assert.equal(rejectedOtherCustomRange.scopeMismatch, true, 'custom ranges with the same rangeKey but different bounds must not match');
assert.equal(rejectedOtherCustomRange.incoming.usage.all.total, current.usage.all.total);

const partial = context.protectRealtimeSnapshotScope(current, {
  ...matching,
  usage: watcher.usage,
  usageScope: watcher.usageScope,
  requestLog: [{ id: 'fresh-range-page' }],
  requestTotal: 408,
}, payload, current.aggregateScope);
assert.equal(partial.scopeMismatch, true);
assert.equal(partial.incoming.usage.all.total, 35394225, 'stale usage must remain protected');
assert.equal(partial.incoming.requestLog[0].id, 'fresh-range-page', 'matching page scope may still update');
assert.equal(partial.incoming.requestTotal, 408);

console.log('ok - realtime filter scope smoke');
