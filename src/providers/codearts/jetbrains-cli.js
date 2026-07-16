'use strict';

const fs = require('node:fs');
const { envelope, failure, databasePagePayload, analyticsPayload, ideDashboardPayload, sanitizeIdeValue } = require('../../protocol/query-results');
const aggregation = require('./aggregation-engine');
const usageRollup = require('./usage-rollup');
const { sourceList } = require('./aggregation-runtime');
const { nativeSqliteStatus } = require('./sqlite');
const { writeRollupState } = require('./rollup-state');
const pagination = require('./pagination');

function readOption(args, name, multiple = false, fallback = null) {
  const values = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === name) values.push(args[index + 1]);
  }
  return multiple && values.length > 1 ? values : values[0] ?? fallback;
}

function dashboardSnapshot(result, timestamp, settings) {
  const usage = result.usage || {};
  const today = usage.today || {};
  const used = Number(today.total || 0);
  const limit = settings.dailyLimit;
  const usagePercent = limit > 0 ? Math.min(999, Math.max(0, (used / limit) * 100)) : 0;
  const resetDate = new Date(timestamp); resetDate.setHours(24, 0, 0, 0);
  const resetAt = resetDate.getTime();
  const remaining = limit > 0 ? Math.max(0, limit - used) : null;
  const level = usagePercent >= 90 ? 'danger' : usagePercent >= 70 ? 'warning' : 'ok';
  const sources = Array.isArray(result.sources) ? result.sources : [];
  const sourceErrors = Array.isArray(result.sourceErrors) ? result.sourceErrors : [];
  const primarySource = sources[0] || {};
  const issues = sourceErrors.map((item) => ({
    level: 'warning',
    code: 'source_read_failed',
    message: `${item?.source || 'local'} 数据源读取失败`,
  }));
  return {
    timestamp,
    updatedAt: new Date(timestamp).toLocaleString('zh-CN', { hour12: false }),
    dbSize: primarySource.dbPath ? fs.statSync(primarySource.dbPath).size : 0,
    adapter: result.nativeError ? 'sql.js' : 'node:sqlite',
    config: settings,
    status: { label: `${Math.round(usagePercent)}%`, usagePercent, level, resetAt, remaining },
    usage,
    expectedSources: result.expectedSources || [],
    trends: { hourly24h: result.buckets || [], daily14d: [] },
    models: result.modelStats || [],
    sourceStats: result.sourceStats || [],
    sessionSummary: result.sessionSummary || {},
    performance: {},
    rollupState: result.rollupState || result.perf?.usageRollup?.current || null,
    queue: {},
    health: {
      level: issues.length ? 'warning' : 'ok',
      label: issues.length ? '部分数据源不可用' : '本地数据正常',
      issues,
    },
    quota: {
      primary: { id: 'daily', label: '今日', used, limit, remaining, percent: usagePercent, resetAt, level },
      note: 'dailyLimit 是本地显示软上限。',
    },
  };
}

async function query(resource, args = []) {
  const requireResult = (result) => {
    if (!result?.ok) throw new Error(result?.error || 'Unable to read local usage data.');
    return result;
  };
  const page = Math.max(1, Math.trunc(Number(readOption(args, '--page', false, 1)) || 1));
  const pageSize = Math.max(1, Math.min(500, Math.trunc(Number(readOption(args, '--page-size', false, 50)) || 50)));
  const sessionId = readOption(args, '--session-id');
  const source = readOption(args, '--source', true);
  const model = readOption(args, '--model', true);
  const project = readOption(args, '--project', true);
  const search = readOption(args, '--search', false, '');
  const start = Math.max(0, Number(readOption(args, '--start', false, 0)) || 0);
  const end = Math.max(0, Number(readOption(args, '--end', false, 0)) || 0);
  const range = { start, end };
  const pageOptions = { page, pageSize, sessionId, source, model, project, query: search, range };
  if (resource === 'analytics') {
    const bucketMs = Math.max(60000, Number(readOption(args, '--bucket-ms', false, 3600000)) || 3600000);
    const offsetValue = readOption(args, '--bucket-offset-ms');
    const bucketOffsetMs = offsetValue == null ? undefined : Number(offsetValue);
    const result = requireResult(await aggregation.getDashboardAggregates({ source, model, project, range, timestamp: end || Date.now(), bucketMs, bucketOffsetMs, disableUsageRollup: true }));
    return analyticsPayload(result, { ...pageOptions, bucketMs, bucketOffsetMs });
  }
  if (resource === 'filters') {
    const result = requireResult(await aggregation.getDashboardAggregates({ source, range, timestamp: end || Date.now(), bucketMs: 86400000, disableUsageRollup: true }));
    return envelope({
      models: result.modelStats || [],
      projects: (result.sessionSummary?.projects || []).map((item) => ({
        id: item.key || item.directory || '__none', directory: item.directory || '', count: Number(item.count || 0),
      })),
    }, pageOptions);
  }
  if (resource === 'diagnostics') return envelope(sanitizeIdeValue(await aggregation.getDatabaseHealth({ source })));
  if (resource === 'rollup') {
    const adapter = process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || !nativeSqliteStatus().available ? 'sql.js' : 'node:sqlite';
    const selected = sourceList({ source });
    const results = [];
    for (const item of selected) {
      const startedAt = Date.now();
      const progress = (state = {}) => writeRollupState(item, {
        adapter, status: state.phase === 'completed' ? 'ready' : 'running',
        phase: state.phase || 'running', percent: state.percent || 0,
        scannedRows: state.scannedRows || 0, totalRows: state.totalRows || 0,
        attempt: 1, fallback: 'direct-sql', startedAt, error: '',
      });
      try {
        writeRollupState(item, { adapter, status: 'running', phase: 'opening', percent: 2, attempt: 1, fallback: 'direct-sql', startedAt, error: '' });
        const result = await usageRollup.buildAndWriteUsageRollupForSource(item, { adapter, onProgress: progress });
        const rowCount = Number(result?.usageRollup?.rowCount || 0);
        writeRollupState(item, { adapter, status: 'ready', phase: 'completed', percent: 100, scannedRows: rowCount, totalRows: rowCount, attempt: 1, fallback: null, startedAt, completedAt: Date.now(), nextRetryAt: 0, error: '' });
        results.push({ sourceId: item.id || 'unknown', status: 'ready', rowCount });
      } catch (error) {
        writeRollupState(item, { adapter, status: 'failed', phase: 'failed', percent: 0, attempt: 1, fallback: 'direct-sql', startedAt, completedAt: Date.now(), nextRetryAt: 0, error });
        throw error;
      }
    }
    return envelope({ status: 'ready', adapter, sources: results });
  }
  if (resource === 'sessions' || resource === 'requests') {
    const payload = { limit: pageSize, offset: (page - 1) * pageSize, query: search, source, model, project, range };
    const result = resource === 'sessions'
      ? await pagination.getSessionsPage({ ...payload, status: 'active' })
      : sessionId
        ? await pagination.getSessionRequestsPage({ ...payload, sessionId })
        : await pagination.getRequestsPage(payload);
    return databasePagePayload(result, pageOptions);
  }
  if (resource === 'dashboard') {
    const positiveNumber = (value, fallback) => Number(value) > 0 ? Number(value) : fallback;
    const timestamp = positiveNumber(process.env.CODEARTS_BAR_NOW_MS, Date.now());
    const settings = {
      dailyLimit: positiveNumber(process.env.CODEARTS_BAR_DAILY_LIMIT, 200000),
      windowHours: Math.min(8760, positiveNumber(process.env.CODEARTS_BAR_WINDOW_HOURS, 24)),
    };
    const result = requireResult(await aggregation.getDashboardAggregates({ source, timestamp, windowHours: settings.windowHours, bucketMs: 3600000 }));
    return ideDashboardPayload(dashboardSnapshot(result, result.timestamp || timestamp, settings), pageOptions);
  }
  throw new Error(`Unknown query resource: ${resource}`);
}

async function run() {
  const args = process.argv.slice(2);
  try {
    if (args[0] !== 'query') throw new Error('JetBrains CLI supports only query commands');
    console.log(JSON.stringify(await query(args[1] || 'dashboard', args.slice(2))));
  }
  catch (error) { console.log(JSON.stringify(failure(sanitizeIdeValue(error?.message || error, 'error')))); process.exitCode = 1; }
}

if (require.main === module) run();
module.exports = { query, dashboardSnapshot, databasePagePayload, dashboardPayload: ideDashboardPayload };
