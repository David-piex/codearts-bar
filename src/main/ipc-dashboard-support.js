'use strict';

const { buildDiagnosticsSummary } = require('./ipc-dashboard-diagnostics');

function paginateSnapshotList(list, payload = {}, { pageBounds, matchesPageFilters, snapshotTimestamp = 0 }) {
  const { limit, offset } = pageBounds(payload);
  const filtered = (list || []).filter((item) => matchesPageFilters(item, payload));
  return {
    ok: true,
    limit,
    offset,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    items: filtered.slice(offset, offset + limit),
    snapshotTimestamp,
  };
}

function createSnapshotFallback(getLastSnapshot) {
  return function snapshotUsageFallback(scope) {
    const snap = getLastSnapshot() || null;
    if (!snap || !snap.ok) return null;
    if (scope === 'summary') return { ok: true, timestamp: snap.timestamp || 0, usage: snap.usage || {}, sources: snap.sources || [], fallback: 'snapshot' };
    if (scope === 'trend') return { ok: true, timestamp: snap.timestamp || 0, buckets: snap.trends?.hourly24h || [], fallback: 'snapshot' };
    if (scope === 'source') return { ok: true, timestamp: snap.timestamp || 0, items: snap.sourceStats || [], fallback: 'snapshot' };
    if (scope === 'model') return { ok: true, timestamp: snap.timestamp || 0, items: snap.models || [], fallback: 'snapshot' };
    if (scope === 'session') return { ok: true, timestamp: snap.timestamp || 0, ...(snap.sessionSummary || {}), fallback: 'snapshot' };
    return null;
  };
}

function runtimeDiagnosticIssues(runtime = null) {
  return Array.isArray(runtime?.issues) ? runtime.issues : [];
}

function decorateWithRuntimeDiagnostics(snapshot, runtime = null) {
  const issues = runtimeDiagnosticIssues(runtime);
  if (!snapshot || typeof snapshot !== 'object' || !issues.length) return snapshot;
  const existing = Array.isArray(snapshot.diagnostics?.issues) ? snapshot.diagnostics.issues : [];
  const seen = new Set(existing.map((item) => `${item.code || item.title}:${item.detail || ''}`));
  const merged = [...existing];
  for (const issue of issues) {
    const key = `${issue.code || issue.title}:${issue.detail || ''}`;
    if (!seen.has(key)) merged.unshift(issue);
  }
  return {
    ...snapshot,
    diagnostics: {
      ...(snapshot.diagnostics || {}),
      issues: merged,
    },
    runtimeDiagnostics: runtime,
  };
}

module.exports = { paginateSnapshotList, createSnapshotFallback, decorateWithRuntimeDiagnostics, buildDiagnosticsSummary };
