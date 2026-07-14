'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DAY_MS,
  MINUTE_MS,
  floorToMinute,
  normalizeRangeFilterValue,
  normalizeCustomRange,
  dateRangeForFilter,
} = require('../src/dashboard/date-range-core');

const timestamp = new Date(2026, 6, 10, 15, 30, 0).getTime();
const timestampWithSeconds = timestamp + 42 * 1000 + 987;
assert.equal(floorToMinute(timestampWithSeconds), timestamp);
assert.equal(normalizeRangeFilterValue('today'), 'today');
assert.equal(normalizeRangeFilterValue('all'), 'all');
assert.equal(normalizeRangeFilterValue('7d'), '7d');
assert.equal(normalizeRangeFilterValue('custom', 42), '42d');
assert.equal(normalizeRangeFilterValue('bad'), 'customTime');

const all = dateRangeForFilter({ range: 'all', timestamp });
assert.deepEqual(all, { start: 0, end: timestamp });
const today = dateRangeForFilter({ range: 'today', timestamp });
assert.equal(today.start, new Date(2026, 6, 10, 0, 0, 0).getTime());
assert.equal(today.end, timestamp);
const sevenDays = dateRangeForFilter({ range: '7d', timestamp });
assert.deepEqual(sevenDays, { start: timestamp - 7 * DAY_MS, end: timestamp });
const thirtyDays = dateRangeForFilter({ range: '30d', timestamp: timestampWithSeconds });
assert.equal(thirtyDays.start, timestampWithSeconds - 30 * DAY_MS);
assert.equal(thirtyDays.end, timestampWithSeconds);
const reversed = normalizeCustomRange(timestamp, timestamp - DAY_MS, timestamp);
assert.deepEqual(reversed, { start: timestamp - DAY_MS, end: timestamp });
const minuteCustom = normalizeCustomRange(timestampWithSeconds - 2 * DAY_MS, timestampWithSeconds, timestampWithSeconds);
assert.deepEqual(minuteCustom, { start: timestampWithSeconds - 2 * DAY_MS, end: timestampWithSeconds });
const custom = dateRangeForFilter({ range: 'customTime', timestamp, customStart: timestamp - 2 * DAY_MS, customEnd: timestamp - DAY_MS });
assert.deepEqual(custom, { start: timestamp - 2 * DAY_MS, end: timestamp - DAY_MS });

const root = path.join(__dirname, '..', 'src');
const dateRangeSource = fs.readFileSync(path.join(root, 'dashboard-date-range.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'dashboard', 'dashboard-bootstrap.js'), 'utf8');
const eventsSource = fs.readFileSync(path.join(root, 'dashboard', 'events', 'date-events.js'), 'utf8');
const sessionFiltersSource = fs.readFileSync(path.join(root, 'dashboard', 'sessions', 'session-filters.js'), 'utf8');
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
assert.match(dateRangeSource, /function sinceForRange[\s\S]*dateRangeForFilter/);
assert.match(dateRangeSource, /endExclusive: range\.end/);
assert.match(bootstrapSource, /endExclusive/);
assert.match(bootstrapSource, /dateRangeForCurrentFilter\(s\)/);
assert.match(sessionFiltersSource, /time >= end/);
assert.match(sessionFiltersSource, /rendererNow/);
const cancelBody = eventsSource.slice(eventsSource.indexOf('if(dateCancel){'), eventsSource.indexOf('if(dateConfirm){'));
assert.doesNotMatch(cancelBody, /statsRange|rangeFilter\s*=/);

console.log('ok - date range pure/state regression');
