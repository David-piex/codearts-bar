'use strict';

const crypto = require('node:crypto');
const pathModule = require('node:path');
const fsModule = require('node:fs');
const { bestEffortStats } = require('./core/best-effort');
const { redactSensitiveText } = require('./core/sensitive-text');

function hashText(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function sanitizeText(value = '', limit = 500) {
  return redactSensitiveText(String(value || ''))
    .replace(/(["']?(?:prompt|systemPrompt|userPrompt|messages|content|input)["']?\s*[:=]\s*)["'][\s\S]*?["']/gi, '$1[redacted]')
    .replace(/[A-Za-z]:[\\/][^\r\n'",;]*/g, '[path]')
    .replace(/\\\\[^\r\n'",;]+/g, '[path]')
    .replace(/\/(?:[^/\s'",;]+\/)+[^/\s'",;]*/g, '[path]')
    .slice(0, limit);
}

function safeId(value = '', fallback = '') {
  const text = String(value || fallback).replace(/[^a-z0-9._:-]+/gi, '_').slice(0, 80);
  return text || fallback;
}

function pathSummary(filePath = '', fs = fsModule, path = pathModule) {
  const value = String(filePath || '');
  let exists = false;
  try { exists = Boolean(value && fs.existsSync(value)); } catch {}
  return {
    name: value ? sanitizeText(path.basename(value), 120) : '',
    hash: value ? hashText(value) : '',
    exists,
  };
}

function sanitizeIssue(issue = {}) {
  return {
    code: safeId(issue.code, 'unknown'),
    level: safeId(issue.tone || issue.level, 'info'),
    source: safeId(issue.source || issue.id, ''),
  };
}

function issueList(...sources) {
  const out = [];
  for (const source of sources) {
    for (const issue of Array.isArray(source) ? source : []) out.push(sanitizeIssue(issue));
  }
  return out.slice(0, 50);
}

function sourceSummary(source = {}, fs = fsModule, path = pathModule) {
  const rawPath = source.dbPath || source.path || '';
  const file = pathSummary(rawPath, fs, path);
  return {
    id: safeId(source.id || source.source, 'unknown'),
    label: sanitizeText(source.label || source.id || source.source || 'unknown', 80),
    exists: source.exists == null ? file.exists : Boolean(source.exists),
    readable: source.readable == null ? undefined : Boolean(source.readable),
    size: Number(source.size || 0),
    messageCount: Number(source.messageCount || source.messages || 0),
    sessionCount: Number(source.sessionCount || source.sessions || 0),
    dbName: file.name,
    dbHash: file.hash,
  };
}

function numericGroup(group = {}, allowed = []) {
  const out = {};
  for (const key of allowed) {
    const value = group?.[key];
    if (value == null) continue;
    out[key] = typeof value === 'boolean' ? value : Number(value);
  }
  return out;
}

function metricGroups(groups = {}) {
  const out = {};
  for (const [key, value] of Object.entries(groups || {})) {
    out[safeId(key, 'unknown')] = numericGroup(value, ['count', 'failed', 'maxMs', 'lastMs']);
  }
  return out;
}

function errorGovernanceSummary() {
  const stats = bestEffortStats() || {};
  return {
    total: Number(stats.total || 0),
    byScope: Object.fromEntries(Object.entries(stats.byScope || {}).map(([key, value]) => [safeId(key, 'unknown'), Number(value || 0)])),
    recent: (Array.isArray(stats.recent) ? stats.recent : []).slice(0, 20).map((event) => ({
      time: Number(event?.time || 0),
      scope: safeId(event?.scope, 'unknown'),
    })),
  };
}

function runtimeSummary(runtime = null) {
  if (!runtime || typeof runtime !== 'object') return null;
  return {
    cleanExit: runtime.marker?.cleanExit ?? runtime.cleanExit ?? null,
    issueCount: Array.isArray(runtime.issues) ? runtime.issues.length : 0,
    status: safeId(runtime.status || runtime.marker?.reason || '', ''),
  };
}

function databaseSummary(database = null, fs = fsModule, path = pathModule) {
  if (!database || typeof database !== 'object') return null;
  const diagnostics = database.diagnostics || {};
  const rawSources = Array.isArray(diagnostics.sources)
    ? diagnostics.sources
    : Array.isArray(database.items)
      ? database.items
      : database.path
        ? [{ id: 'selected', path: database.path, exists: database.exists, size: database.size }]
        : [];
  return {
    ok: Boolean(database.ok ?? diagnostics.ok),
    adapter: safeId(database.adapter || diagnostics.runtime?.preferred || '', ''),
    sourceCount: rawSources.length,
    sources: rawSources.slice(0, 20).map((source) => sourceSummary(source, fs, path)),
    hasError: Boolean(database.error),
  };
}

function buildUnifiedDiagnostics({ snapshot = null, database = null, runtime = null, performance = null, paths = {}, fs = fsModule, path = pathModule, version = '', now = Date.now() }) {
  const issues = issueList(snapshot?.health?.issues, database?.diagnostics?.issues, runtime?.issues);
  const rollup = performance?.usageRollup || {};
  const cache = performance?.aggregateCache || {};
  const slow = performance?.slowAggregates || {};
  return {
    schemaVersion: 2,
    generatedAt: Number(now || 0),
    version: sanitizeText(version, 40),
    errorGovernance: errorGovernanceSummary(),
    health: snapshot?.health ? { ok: Boolean(snapshot.health.ok), issueCount: Array.isArray(snapshot.health.issues) ? snapshot.health.issues.length : 0 } : null,
    database: databaseSummary(database, fs, path),
    adapter: safeId(snapshot?.adapter || database?.adapter || database?.diagnostics?.runtime?.preferred || '', ''),
    rollup: numericGroup(rollup, ['enabled', 'buildEnabled', 'pendingCount', 'reads', 'misses', 'invalid', 'hitRate', 'lastBuildMs', 'buildFailed', 'buildCompleted']),
    cache: numericGroup(cache, ['hits', 'misses', 'reads', 'hitRate', 'size', 'limit']),
    slowQueries: {
      ...numericGroup(slow, ['count', 'failed', 'maxMs']),
      byLabel: metricGroups(slow.byLabel),
      byAdapter: metricGroups(slow.byAdapter),
    },
    runtime: runtimeSummary(runtime),
    paths: Object.fromEntries(Object.entries(paths || {}).map(([key, value]) => [safeId(key, 'path'), pathSummary(value, fs, path)])),
    issues,
  };
}

module.exports = {
  buildUnifiedDiagnostics,
  databaseSummary,
  hashText,
  pathSummary,
  sanitizeIssue,
  sanitizeText,
};
