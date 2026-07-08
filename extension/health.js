'use strict';

function levelRank(level) { return level === 'danger' ? 3 : level === 'warning' ? 2 : level === 'unknown' ? 1 : 0; }
function worst(items) {
  return items.reduce((a, b) => levelRank(b.level) > levelRank(a.level) ? b : a, { level: 'ok', label: 'OK', message: '运行正常' });
}
function buildHealth(snapshot, settings = {}) {
  if (!snapshot || !snapshot.ok) return { level: 'danger', label: 'Snapshot error', issues: [{ level: 'danger', code: 'snapshot_error', message: snapshot?.error || '无快照' }] };
  const issues = [];
  const quota = snapshot.quota?.primary;
  if (quota && quota.percent != null) {
    if (quota.percent >= 90) issues.push({ level: 'danger', code: 'quota_danger', message: `今日用量 ${Math.round(quota.percent)}%` });
    else if (quota.percent >= 70) issues.push({ level: 'warning', code: 'quota_warning', message: `今日用量 ${Math.round(quota.percent)}%` });
  }
  const perf = snapshot.performance?.window;
  const ttftWarnMs = Number(settings.ttftWarnMs || 5000);
  const latencyWarnMs = Number(settings.latencyWarnMs || 60000);
  if (perf?.ttft?.p95 && perf.ttft.p95 >= ttftWarnMs) issues.push({ level: 'warning', code: 'ttft_high', message: `TTFT P95 ${Math.round(perf.ttft.p95)}ms` });
  if (perf?.latency?.p95 && perf.latency.p95 >= latencyWarnMs) issues.push({ level: 'warning', code: 'latency_high', message: `Latency P95 ${Math.round(perf.latency.p95)}ms` });
  if (perf?.errorRate >= 0.2 && perf.samples >= 5) issues.push({ level: 'danger', code: 'error_rate_high', message: `错误率 ${(perf.errorRate * 100).toFixed(1)}%` });
  else if (perf?.errorRate >= 0.05 && perf.samples >= 5) issues.push({ level: 'warning', code: 'error_rate_warning', message: `错误率 ${(perf.errorRate * 100).toFixed(1)}%` });
  const top = worst(issues);
  return { level: top.level, label: top.label || top.code || 'OK', message: top.message, issues };
}
function notificationEvents(prev, next) {
  if (!next || !next.issues) return [];
  const prevCodes = new Set((prev?.issues || []).map((i) => `${i.level}:${i.code}`));
  return next.issues.filter((i) => !prevCodes.has(`${i.level}:${i.code}`) && ['warning', 'danger'].includes(i.level));
}
module.exports = { buildHealth, notificationEvents };
