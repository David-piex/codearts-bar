'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DAY_MS,
  normalizeRangeFilterValue,
  normalizeCustomRange,
  dateRangeForFilter,
} = require('../src/dashboard/date-range-core');

const timestamp = new Date(2026, 6, 10, 15, 30, 0).getTime();
assert.equal(normalizeRangeFilterValue('today'), 'today');
assert.equal(normalizeRangeFilterValue('all'), 'all');
assert.equal(normalizeRangeFilterValue('7d'), '7d');
assert.equal(normalizeRangeFilterValue('custom', 42), '42d');
assert.equal(normalizeRangeFilterValue('bad'), 'customTime');

const all = dateRangeForFilter({ range: 'all', timestamp });
assert.deepEqual(all, { start: 0, end: 0 });
const today = dateRangeForFilter({ range: 'today', timestamp });
assert.equal(today.start, new Date(2026, 6, 10, 0, 0, 0).getTime());
assert.equal(today.end, 0);
const sevenDays = dateRangeForFilter({ range: '7d', timestamp });
assert.deepEqual(sevenDays, { start: timestamp - 7 * DAY_MS, end: 0 });
const reversed = normalizeCustomRange(timestamp, timestamp - DAY_MS, timestamp);
assert.deepEqual(reversed, { start: timestamp - DAY_MS, end: timestamp });
const custom = dateRangeForFilter({ range: 'customTime', timestamp, customStart: timestamp - 2 * DAY_MS, customEnd: timestamp - DAY_MS });
assert.deepEqual(custom, { start: timestamp - 2 * DAY_MS, end: timestamp - DAY_MS });

const root = path.join(__dirname, '..', 'src');
const dateRangeSource = fs.readFileSync(path.join(root, 'dashboard-date-range.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'dashboard', 'dashboard-bootstrap.js'), 'utf8');
const eventsSource = fs.readFileSync(path.join(root, 'dashboard', 'events', 'date-events.js'), 'utf8');
const rangeHtmlBody = dateRangeSource.slice(dateRangeSource.indexOf('function rangeHtml(){'), dateRangeSource.indexOf('function rangeHtml(){') + 900);
assert.ok(rangeHtmlBody, 'rangeHtml body should be discoverable');
assert.doesNotMatch(rangeHtmlBody, /localStorage\.setItem/);
assert.doesNotMatch(rangeHtmlBody, /rangeFilter\s*=\s*['"]customTime/);
assert.match(bootstrapSource, /function applyCustomDateInputs\(\)/);
assert.match(bootstrapSource, /rangeFilter = 'customTime'/);
assert.match(bootstrapSource, /localStorage\.setItem\('statsRange', rangeFilter\)/);
assert.match(eventsSource, /dateCancel[\s\S]*?dateRangeOpen = false[\s\S]*?dateRangeDraftStart = 0/);
assert.match(dateRangeSource, /dateRangeFutureInvalid/);
assert.match(dateRangeSource, /end > now \+ 60000/);
const cancelBody = eventsSource.slice(eventsSource.indexOf('if(dateCancel){'), eventsSource.indexOf('if(dateConfirm){'));
assert.doesNotMatch(cancelBody, /statsRange|rangeFilter\s*=/);

console.log('ok - date range pure/state regression');
