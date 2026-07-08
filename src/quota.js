'use strict';

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function dayStartMs(timestamp = Date.now()) { const d = new Date(timestamp); d.setHours(0, 0, 0, 0); return d.getTime(); }
function nextDayStartMs(timestamp = Date.now()) { const d = new Date(timestamp); d.setHours(24, 0, 0, 0); return d.getTime(); }
function summarizeWindow({ id, label, used, limit, resetAt, type, source, timestamp }) {
  const safeLimit = Number(limit || 0);
  const percent = safeLimit > 0 ? clamp((Number(used || 0) / safeLimit) * 100, 0, 999) : null;
  const remaining = safeLimit > 0 ? Math.max(0, safeLimit - Number(used || 0)) : null;
  return {
    id,
    label,
    type,
    source,
    used: Number(used || 0),
    limit: safeLimit || null,
    remaining,
    percent,
    resetAt,
    resetInMs: resetAt ? Math.max(0, resetAt - timestamp) : null,
    level: percent == null ? 'unknown' : percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'ok',
  };
}
function estimateDepletion({ used, limit, sinceMs, timestamp }) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || used <= 0) return null;
  const elapsed = Math.max(60 * 1000, timestamp - sinceMs);
  const ratePerMs = used / elapsed;
  const remaining = limit - used;
  if (remaining <= 0) return { depleted: true, at: timestamp, inMs: 0, ratePerHour: ratePerMs * 3600 * 1000 };
  const inMs = remaining / ratePerMs;
  return { depleted: false, at: timestamp + inMs, inMs, ratePerHour: ratePerMs * 3600 * 1000 };
}
function buildQuota(snapshotLike, options = {}) {
  const timestamp = Number(options.timestamp || snapshotLike.timestamp || Date.now());
  const dailyLimit = Number(options.dailyLimit || snapshotLike.config?.dailyLimit || 0);
  const windowHours = Number(options.windowHours || snapshotLike.config?.windowHours || 24);
  const todayStart = dayStartMs(timestamp);
  const rollingStart = timestamp - windowHours * 3600 * 1000;
  const daily = summarizeWindow({ id: 'daily', label: '今日', type: 'local-stat', source: 'local-display', used: snapshotLike.usage?.today?.total || 0, limit: dailyLimit, resetAt: nextDayStartMs(timestamp), timestamp });
  const rolling = summarizeWindow({ id: 'rolling', label: `${windowHours}h`, type: 'local-stat', source: 'local-display', used: snapshotLike.usage?.window?.total || 0, limit: null, resetAt: null, timestamp });
  const weekly = summarizeWindow({ id: 'weekly', label: '7d', type: 'local-stat', source: 'local-display', used: snapshotLike.usage?.week?.total || 0, limit: null, resetAt: null, timestamp });
  const primary = daily;
  return {
    source: 'local-display',
    note: '\u8fd9\u91cc\u7684 dailyLimit \u53ea\u662f\u672c\u5730\u663e\u793a\u7528\u8f6f\u4e0a\u9650\uff0c\u4e0d\u4ee3\u8868\u7801\u9053\u5b98\u65b9\u9650\u5236\uff1b\u6392\u961f\u7b49\u5f85/\u5e76\u53d1\u9650\u5236\u4ee5\u7801\u9053\u5ba2\u6237\u7aef\u5b9e\u9645\u63d0\u793a\u4e3a\u51c6\u3002',
    officialResetKnown: false,
    primary,
    windows: [daily, rolling, weekly],
    depletion: {
      daily: estimateDepletion({ used: daily.used, limit: daily.limit, sinceMs: todayStart, timestamp }),
      rolling: estimateDepletion({ used: rolling.used, limit: rolling.limit, sinceMs: rollingStart, timestamp }),
      weekly: null,
    },
  };
}
module.exports = { buildQuota, dayStartMs, nextDayStartMs, summarizeWindow, estimateDepletion };
