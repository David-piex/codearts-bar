'use strict';
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function fmtInt(value) { return new Intl.NumberFormat('zh-CN').format(Math.round(value || 0)); }
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '未知';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.round(min / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
function fmtTime(ms) { if (!ms) return '未知'; return new Date(ms).toLocaleString('zh-CN', { hour12: false }); }
function fmtMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}
module.exports = { clamp, fmtInt, fmtDuration, fmtTime, fmtMs };
