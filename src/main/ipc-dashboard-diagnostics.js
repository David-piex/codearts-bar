'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const pathModule = require('node:path');
const { redactSensitiveText } = require('../core/sensitive-text');

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function sanitizeText(value = '') {
  return redactSensitiveText(String(value || ''))
    .replace(/[A-Za-z]:[\\/][^\s'",;]+/g, '[path]')
    .replace(/\/(?:[^/\s'",;]+\/)+[^/\s'",;]+/g, '[path]')
    .replace(/\\\\(?:[^\\\s'",;]+\\)+[^\\\s'",;]+/g, '[path]')
    .slice(0, 300);
}

function sanitizeRollupError(value = '') {
  const text = String(value || '');
  if (!text) return '';
  if (/timed? out|timeout|超时/i.test(text)) return '后台缓存构建超时';
  if (/EACCES|EPERM|permission|权限|access denied/i.test(text)) return '后台缓存无写入权限';
  if (/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(text)) return '数据库暂时被占用';
  if (/malformed|corrupt|database disk image|file is not a database|缺少.*表|no such table|schema/i.test(text)) return '数据库结构不兼容或已损坏';
  return '后台缓存构建失败';
}

function safePathSummary(filePath = '', pathLike = pathModule) {
  const value = String(filePath || '');
  if (!value) return { name: '', hash: '', exists: false };
  let exists = false;
  try { exists = fs.existsSync(value); } catch {}
  return {
    name: pathLike.basename(value),
    hash: hashText(value),
    exists,
  };
}

function sanitizeMetricGroups(groups = {}) {
  const out = {};
  for (const [key, value] of Object.entries(groups || {})) {
    out[sanitizeText(key)] = {
      count: Number(value?.count || 0),
      failed: Number(value?.failed || 0),
      maxMs: Number(value?.maxMs || 0),
      lastMs: Number(value?.lastMs || 0),
    };
  }
  return out;
}

function issueBucket(issues = []) {
  const grouped = { bad: [], warn: [], info: [] };
  for (const issue of Array.isArray(issues) ? issues : []) {
    const tone = issue?.tone === 'bad' || issue?.tone === 'danger' || issue?.tone === 'error'
      ? 'bad'
      : issue?.tone === 'warn' || issue?.tone === 'warning'
        ? 'warn'
        : 'info';
    grouped[tone].push({
      code: String(issue?.code || ''),
      source: String(issue?.source || ''),
      title: sanitizeText(issue?.title || issue?.code || ''),
      detail: sanitizeText(issue?.detail || issue?.message || issue?.error || ''),
    });
  }
  return grouped;
}

function sourceSummary(source = {}, pathLike = pathModule) {
  const dbPath = String(source.dbPath || source.path || '');
  const messageCount = Number(source.messageCount || source.messages || 0);
  const sessionCount = Number(source.sessionCount || source.sessions || 0);
  return {
    id: String(source.id || source.source || ''),
    label: String(source.label || source.id || source.source || ''),
    exists: Boolean(source.exists),
    readable: Boolean(source.readable),
    size: Number(source.size || 0),
    messageCount,
    sessionCount,
    empty: Boolean(source.exists && source.readable && messageCount === 0 && sessionCount === 0),
    dbName: dbPath ? pathLike.basename(dbPath) : '',
    dbHash: dbPath ? hashText(dbPath) : '',
  };
}

function sourceStatusSummary(sources = []) {
  const byId = {};
  for (const source of sources) {
    byId[source.id || source.label || 'unknown'] = {
      label: source.label,
      exists: Boolean(source.exists),
      readable: Boolean(source.readable),
      empty: Boolean(source.empty),
      messageCount: Number(source.messageCount || 0),
      sessionCount: Number(source.sessionCount || 0),
      dbName: source.dbName || '',
      dbHash: source.dbHash || '',
    };
  }
  return byId;
}

function diagnosticNextActions({ status, missingSources, emptyReadableSources, fallbackActive, badCount, warnCount, runtimeIssues, sidecar = {}, slowAggregates = {} }) {
  const actions = [];
  if (missingSources.length) {
    actions.push({
      code: 'check_data_source',
      title: '检查 CodeArts 数据源',
      detail: '没有找到可读取的 opencode.db。请先运行 CodeArts Agent 桌面端或 CLI，或在设置中确认数据库路径。',
    });
  }
  if (emptyReadableSources.length) {
    actions.push({
      code: 'produce_first_session',
      title: '先产生一条会话数据',
      detail: '数据库可以读取，但 message/session 表暂时为空。请在 CodeArts Agent 或 CLI 中完成一次会话后刷新。',
    });
  }
  if (fallbackActive) {
    actions.push({
      code: 'sqlite_fallback_active',
      title: '当前使用 sql.js 兼容模式',
      detail: 'node:sqlite 当前不可用，已自动回退到 sql.js。功能可用，但首次聚合可能更慢。',
    });
  }
  if (Number(slowAggregates.count || 0) > 0 || Number(slowAggregates.maxMs || 0) >= 300) {
    actions.push({
      code: 'review_slow_aggregates',
      title: '检查聚合缓存与 sidecar',
      detail: '检测到 300ms 以上的冷聚合。请等待 rollup/sidecar 缓存完成，再观察热路径耗时。',
    });
  }
  if (Number(sidecar.pendingCount || 0) > 0) {
    actions.push({
      code: 'wait_sidecar_build',
      title: '等待 sidecar 缓存建立',
      detail: 'usage rollup 正在后台构建。大数据量首次生成可能稍慢，完成后刷新会明显加快。',
    });
  }
  if (sidecar.current?.status === 'failed' || Number(sidecar.invalid || 0) > 0) {
    actions.push({
      code: 'check_sidecar_cache',
      title: '检查 sidecar 缓存',
      detail: '检测到 rollup 构建失败或缓存失效。可刷新重试，并复制诊断报告排查。',
    });
  }
  if (runtimeIssues) {
    actions.push({
      code: 'review_crash_logs',
      title: '检查运行日志',
      detail: '检测到上次异常退出或渲染错误。请查看本地日志，并复制脱敏诊断报告。',
    });
  }
  if (!actions.length && (badCount || warnCount)) {
    actions.push({
      code: 'copy_diagnostics',
      title: '复制诊断报告',
      detail: '复制脱敏诊断报告后，可将内容附到 issue 中协助定位。',
    });
  }
  if (!actions.length && status === 'ok') {
    actions.push({
      code: 'all_good',
      title: '运行状态正常',
      detail: '数据源、SQLite 运行时和缓存状态均未发现需要处理的问题。',
    });
  }
  return actions.slice(0, 5);
}

function buildDiagnosticsSummary(payload = {}, pathLike = pathModule) {
  const database = payload.database || {};
  const diagnostics = database?.diagnostics || {};
  const sqliteRuntime = diagnostics?.runtime || {};
  const native = sqliteRuntime?.native || {};
  const adapter = sqliteRuntime?.preferred || native?.adapter || (database?.nativeError ? 'sql.js' : 'unknown');
  const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues : [];
  const groupedIssues = issueBucket([
    ...issues,
    ...((Array.isArray(payload.runtime?.issues) ? payload.runtime.issues : [])),
  ]);
  const sources = Array.isArray(diagnostics?.sources)
    ? diagnostics.sources.map((source) => sourceSummary(source, pathLike))
    : Array.isArray(database?.items)
      ? database.items.map((source) => sourceSummary(source, pathLike))
      : [];
  const missingSources = sources.filter((source) => !source.exists);
  const emptySources = sources.filter((source) => source.exists && Number(source.size || 0) === 0);
  const emptyReadableSources = sources.filter((source) => source.exists && source.readable && source.empty);
  const readableSources = sources.filter((source) => source.exists && source.readable);
  const usageRollup = payload.performance?.usageRollup || {};
  const currentRollup = usageRollup.current || {};
  const aggregateCache = payload.performance?.aggregateCache || {};
  const slowAggregates = payload.performance?.slowAggregates || {};
  const wasmPath = sqliteRuntime?.fallback?.wasm || '';
  const fallbackActive = adapter === 'sql.js' || Boolean(database?.nativeError) || issues.some((issue) => issue?.code === 'sqlite_fallback' || issue?.code === 'node_sqlite_unavailable');
  const badCount = groupedIssues.bad.length;
  const warnCount = groupedIssues.warn.length;
  const status = badCount ? 'bad' : warnCount ? 'warn' : 'ok';
  const runtimeIssues = Boolean(Array.isArray(payload.runtime?.issues) && payload.runtime.issues.length);
  return {
    status,
    adapter,
    fallbackActive,
    sourceCount: sources.length,
    readableSources: readableSources.length,
    sourceStatus: sourceStatusSummary(sources),
    missingSources,
    emptySources,
    emptyReadableSources,
    issues: groupedIssues,
    nextActions: diagnosticNextActions({ status, missingSources, emptyReadableSources, fallbackActive, badCount, warnCount, runtimeIssues, sidecar: usageRollup, slowAggregates }),
    sidecar: {
      enabled: usageRollup.enabled !== false,
      buildEnabled: usageRollup.buildEnabled !== false,
      pendingCount: Number(usageRollup.pendingCount || 0),
      hitRate: usageRollup.hitRate ?? null,
      reads: Number(usageRollup.reads || 0),
      misses: Number(usageRollup.misses || 0),
      invalid: Number(usageRollup.invalid || 0),
      lastBuildMs: usageRollup.lastBuildMs ?? null,
      lastBuildStatus: usageRollup.lastBuild?.status || null,
      buildFailed: Number(usageRollup.buildFailed || 0),
      buildCompleted: Number(usageRollup.buildCompleted || 0),
      current: {
        status: String(currentRollup.status || 'idle'),
        phase: String(currentRollup.phase || 'idle'),
        percent: Number(currentRollup.percent || 0),
        scannedRows: Number(currentRollup.scannedRows || 0),
        totalRows: Number(currentRollup.totalRows || 0),
        attempt: Number(currentRollup.attempt || 1),
        fallback: currentRollup.fallback === 'direct-sql' ? 'direct-sql' : null,
        nextRetryAt: Number(currentRollup.nextRetryAt || 0),
        error: sanitizeRollupError(currentRollup.error || ''),
      },
    },
    aggregateCache: {
      hits: Number(aggregateCache.hits || 0),
      misses: Number(aggregateCache.misses || 0),
      reads: Number(aggregateCache.reads || 0),
      hitRate: aggregateCache.hitRate ?? null,
      size: Number(aggregateCache.size || 0),
      limit: Number(aggregateCache.limit || 0),
    },
    slowAggregates: {
      count: Number(slowAggregates.count || 0),
      failed: Number(slowAggregates.failed || 0),
      maxMs: Number(slowAggregates.maxMs || 0),
      last: slowAggregates.last ? {
        label: String(slowAggregates.last.label || ''),
        adapter: String(slowAggregates.last.adapter || ''),
        ms: Number(slowAggregates.last.ms || 0),
        failed: Boolean(slowAggregates.last.failed),
        scope: sanitizeText(slowAggregates.last.scope || ''),
        timestamp: Number(slowAggregates.last.timestamp || 0),
      } : null,
      byLabel: sanitizeMetricGroups(slowAggregates.byLabel),
      byAdapter: sanitizeMetricGroups(slowAggregates.byAdapter),
    },
    resources: {
      sqlWasm: {
        name: wasmPath ? pathLike.basename(wasmPath) : 'sql-wasm.wasm',
        hash: wasmPath ? hashText(wasmPath) : '',
        exists: wasmPath ? safePathSummary(wasmPath, pathLike).exists : false,
      },
    },
    logs: {
      logPathSafeName: payload.logPath ? pathLike.basename(payload.logPath) : '',
      logPathHash: payload.logPath ? hashText(payload.logPath) : '',
      hasLogPath: Boolean(payload.logPath),
      userDataHash: payload.userData ? hashText(payload.userData) : '',
      distHash: payload.distPath ? hashText(payload.distPath) : '',
    },
    crash: {
      cleanExit: payload.runtime?.marker?.cleanExit ?? null,
      issueCount: Array.isArray(payload.runtime?.issues) ? payload.runtime.issues.length : 0,
      hasRuntimeIssues: runtimeIssues,
    },
  };
}

module.exports = { buildDiagnosticsSummary };
