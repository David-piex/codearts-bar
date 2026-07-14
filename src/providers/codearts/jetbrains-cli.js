'use strict';

const fs = require('node:fs');
const { queryPayload, databasePagePayload } = require('../../protocol/query');
const { envelope, failure } = require('../../protocol/envelope');
const aggregation = require('./aggregation-engine');
const pagination = require('./pagination');

const DEFAULT_DAILY_LIMIT = 200000;
const DEFAULT_WINDOW_HOURS = 24;

function readOption(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function usageFromBuckets(buckets = []) {
  const fields = ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'messages', 'errors', 'cacheHitDenominator'];
  const usage = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const bucket of buckets || []) for (const field of fields) usage[field] += Number(bucket?.[field] || 0);
  usage.cacheHitRate = usage.cacheHitDenominator > 0 ? (usage.cacheRead / usage.cacheHitDenominator) * 100 : null;
  return usage;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nextDayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function databaseSize(source) {
  try { return fs.statSync(source?.dbPath || '').size; }
  catch { return 0; }
}

function dashboardSnapshot(result, timestamp, settings) {
  const usage = result.usage || {};
  const today = usage.today || {};
  const used = Number(today.total || 0);
  const limit = settings.dailyLimit;
  const usagePercent = limit > 0 ? Math.min(999, Math.max(0, (used / limit) * 100)) : 0;
  const resetAt = nextDayStart(timestamp);
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
    ok: true,
    timestamp,
    updatedAt: new Date(timestamp).toLocaleString('zh-CN', { hour12: false }),
    dbPath: primarySource.dbPath || '',
    dbSize: databaseSize(primarySource),
    adapter: result.nativeError ? 'sql.js' : 'node:sqlite',
    config: settings,
    status: { label: `${Math.round(usagePercent)}%`, usagePercent, level, resetAt, remaining },
    usage,
    trends: { hourly24h: result.buckets || [], daily14d: [] },
    models: result.modelStats || [],
    sourceStats: result.sourceStats || [],
    sessions: [],
    sessionSummary: result.sessionSummary || {},
    requestLog: [],
    performance: {},
    queue: {},
    tools: {},
    health: {
      level: issues.length ? 'warning' : 'ok',
      label: issues.length ? '部分数据源不可用' : '本地数据正常',
      message: issues.length ? '部分本地数据源读取失败' : '数据库与本地聚合可用',
      issues,
    },
    quota: {
      primary: { id: 'daily', label: '今日', used, limit, remaining, percent: usagePercent, resetAt, level },
      note: 'dailyLimit 是本地显示软上限，不代表码道官方限制。',
    },
    freshness: { source: 'live', stale: false, ageMs: 0 },
    providers: [],
    process: {},
  };
}

async function query(resource, args = []) {
  const page = Math.max(1, Math.trunc(Number(readOption(args, '--page', 1)) || 1));
  const pageSize = Math.max(1, Math.min(500, Math.trunc(Number(readOption(args, '--page-size', 50)) || 50)));
  const sessionId = readOption(args, '--session-id');
  const source = readOption(args, '--source');
  const search = readOption(args, '--search', '');
  const start = Math.max(0, Number(readOption(args, '--start', 0)) || 0);
  const end = Math.max(0, Number(readOption(args, '--end', 0)) || 0);
  const range = { start, end };
  const pageOptions = { page, pageSize, sessionId, source, query: search, range };
  if (resource === 'analytics') {
    const bucketMs = Math.max(60000, Number(readOption(args, '--bucket-ms', 3600000)) || 3600000);
    const offsetValue = readOption(args, '--bucket-offset-ms');
    const bucketOffsetMs = offsetValue == null ? undefined : Number(offsetValue);
    const result = await aggregation.getDashboardAggregates({ source, range, timestamp: end || Date.now(), bucketMs, bucketOffsetMs });
    if (!result?.ok) throw new Error(result?.error || 'Unable to aggregate local usage data.');
    const buckets = Array.isArray(result.buckets) ? result.buckets : [];
    return envelope({
      start: result.start || start,
      end: result.end || end,
      bucketMs: result.bucketMs || bucketMs,
      bucketOffsetMs: result.bucketOffsetMs ?? bucketOffsetMs ?? 0,
      usage: usageFromBuckets(buckets),
      trend: buckets,
      models: result.modelStats || [],
      sources: result.sourceStats || [],
    }, pageOptions);
  }
  if (resource === 'sessions' || resource === 'requests') {
    const payload = { limit: pageSize, offset: (page - 1) * pageSize, query: search, source, range };
    const result = resource === 'sessions'
      ? await pagination.getSessionsPage({ ...payload, status: 'active' })
      : sessionId
        ? await pagination.getSessionRequestsPage({ ...payload, sessionId })
        : await pagination.getRequestsPage(payload);
    return databasePagePayload(result, pageOptions);
  }
  if (resource === 'dashboard') {
    const timestamp = end || positiveNumber(process.env.CODEARTS_BAR_NOW_MS, Date.now());
    const settings = {
      dailyLimit: positiveNumber(process.env.CODEARTS_BAR_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
      windowHours: Math.min(24 * 365, positiveNumber(process.env.CODEARTS_BAR_WINDOW_HOURS, DEFAULT_WINDOW_HOURS)),
    };
    const result = await aggregation.getDashboardAggregates({ source, timestamp, windowHours: settings.windowHours, bucketMs: 3600000 });
    if (!result?.ok) throw new Error(result?.error || 'Unable to read local usage data.');
    return queryPayload(dashboardSnapshot(result, result.timestamp || timestamp, settings), 'dashboard', pageOptions);
  }
  throw new Error(`Unknown query resource: ${resource}`);
}

async function run() {
  const args = process.argv.slice(2);
  if (args[0] !== 'query') throw new Error('JetBrains CLI supports only query commands');
  try { console.log(JSON.stringify(await query(args[1] || 'dashboard', args.slice(2)))); }
  catch (error) { console.log(JSON.stringify(failure(error))); process.exitCode = 1; }
}

if (require.main === module) run().catch((error) => { console.log(JSON.stringify(failure(error))); process.exitCode = 1; });
module.exports = { query, readOption, usageFromBuckets, positiveNumber, nextDayStart, dashboardSnapshot };
