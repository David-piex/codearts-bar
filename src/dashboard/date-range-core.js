'use strict';

const DAY_MS = 86400000;
const MINUTE_MS = 60000;

function floorToMinute(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return Date.now() - (Date.now() % MINUTE_MS);
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

function normalizeRangeFilterValue(value, customDays = 60) {
  const raw = String(value || 'customTime');
  if (raw === 'customTime') return raw;
  if (raw === 'custom') return `${Math.max(2, Math.min(365, Number(customDays) || 60))}d`;
  if (raw === 'all' || raw === 'today') return raw;
  const days = Number(raw.replace('d', ''));
  return Number.isFinite(days) && days > 0
    ? `${Math.max(1, Math.min(365, Math.round(days)))}d`
    : 'customTime';
}

function localDayStart(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeCustomRange(startValue, endValue, timestamp = Date.now()) {
  const now = Number(timestamp) || Date.now();
  let start = Number(startValue || 0);
  let end = Number(endValue || 0);
  if (!Number.isFinite(end) || end <= 0) end = now;
  if (!Number.isFinite(start) || start <= 0) start = end - DAY_MS;
  end = Math.min(end, now);
  start = floorToMinute(start);
  end = floorToMinute(end);
  if (start > end) [start, end] = [end, start];
  if (start >= end) start = end - DAY_MS;
  if (end - start > 366 * DAY_MS) start = end - 366 * DAY_MS;
  return { start, end };
}

function dateRangeForFilter({ range, timestamp, customStart, customEnd, customDays = 60 } = {}) {
  const normalized = normalizeRangeFilterValue(range, customDays);
  const now = Number(timestamp) || Date.now();
  if (normalized === 'customTime') return normalizeCustomRange(customStart, customEnd, now);
  if (normalized === 'all') return { start: 0, end: 0 };
  if (normalized === 'today') return { start: localDayStart(now), end: 0 };
  const days = Number(normalized.replace('d', '')) || 1;
  const minuteNow = floorToMinute(now);
  return { start: minuteNow - days * DAY_MS, end: 0 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DAY_MS, MINUTE_MS, floorToMinute, normalizeRangeFilterValue, localDayStart, normalizeCustomRange, dateRangeForFilter };
}
