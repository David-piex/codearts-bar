'use strict';

const { createSingleFlight } = require('./core/single-flight');
const snapshotFlights = createSingleFlight();

const { loadSettings, writeCache, readCache } = require('./settings');
const { buildQuota } = require('./quota');
const { buildHealth } = require('./health');
const { listProviders } = require('./providers');
const localProvider = require('./providers/codeartsLocal');
const agg = require('./core/aggregator');
const { clamp, fmtInt, fmtDuration, fmtTime, fmtMs } = require('./core/format');
const path = require('node:path');

const DEFAULT_DB_PATH = localProvider.DEFAULT_DB_PATH;
const DEFAULT_DAILY_LIMIT = 200_000;
const DEFAULT_WINDOW_HOURS = 24;

function nowMs() { return Date.now(); }
function resolveDbPath(options = {}) { return localProvider.resolveDbPath(options); }
function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();
}
function allowsSnapshotCacheFallback(options = {}) {
  if (process.env.CODEARTS_BAR_DB) return false;
  const selected = options.dbPath || loadSettings().dbPath;
  return !selected || samePath(selected, DEFAULT_DB_PATH);
}
function isAutomaticSourceSnapshot(snapshot = {}) {
  const automaticPaths = localProvider.SOURCE_DEFS.map((source) => source.dbPath);
  const cachedPaths = (snapshot.sources || []).map((source) => source.dbPath).filter(Boolean);
  if (!cachedPaths.length && snapshot.dbPath) cachedPaths.push(snapshot.dbPath);
  return cachedPaths.length > 0 && cachedPaths.every((cachedPath) => automaticPaths.some((automaticPath) => samePath(cachedPath, automaticPath)));
}
function buildRequestRows(messages, sessions, partMap, ttftMap) {
  const sessionMap = new Map((sessions || []).map((s) => [`${s.source || ''}:${s.id || ''}`, s]));
  return (messages || [])
    .map((row) => {
      const data = agg.parseJsonSafe(row.data, {});
      if (data.role !== 'assistant') return null;
      const token = agg.tokenForMessage(row, partMap);
      const perf = agg.messagePerf(row, partMap, ttftMap) || {};
      const session = sessionMap.get(`${row.source || ''}:${row.session_id || ''}`) || {};
      const error = agg.extractError(data);
      return {
        id: row.id,
        sessionId: row.session_id,
        sessionTitle: session.title || '(无标题)',
        source: row.source || 'unknown',
        sourceLabel: row.sourceLabel || row.source || 'unknown',
        provider: data.providerID || data.model?.providerID || perf.provider || 'unknown',
        model: data.modelID || data.model?.modelID || perf.model || 'unknown',
        createdAt: row.time_created,
        updatedAt: row.time_updated,
        time: row.time_created,
        status: error?.statusCode || (data.error ? 'error' : 200),
        ok: !data.error,
        error: error ? error.message : null,
        latencyMs: perf.latencyMs,
        ttftMs: perf.ttftMs,
        firstContentMs: perf.firstContentMs,
        outputTokensPerSec: perf.outputTokensPerSec,
        ...token,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time)
    .slice(0, 2000);
}
function aggregateBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item) || 'unknown';
    const prev = map.get(key) || { key, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, requests: 0, errors: 0, latencyMs: [], ttftMs: [] };
    prev.total += item.total || 0;
    prev.input += item.input || 0;
    prev.output += item.output || 0;
    prev.reasoning += item.reasoning || 0;
    prev.cacheRead += item.cacheRead || 0;
    prev.cacheWrite += item.cacheWrite || 0;
    prev.requests += 1;
    if (!item.ok) prev.errors += 1;
    if (Number.isFinite(item.latencyMs)) prev.latencyMs.push(item.latencyMs);
    if (Number.isFinite(item.ttftMs)) prev.ttftMs.push(item.ttftMs);
    map.set(key, prev);
  }
  return [...map.values()].map((x) => {
    const latency = agg.summarize(x.latencyMs);
    const ttft = agg.summarize(x.ttftMs);
    delete x.latencyMs; delete x.ttftMs;
    return { ...x, latency, ttft };
  }).sort((a, b) => b.total - a.total);
}
function buildSnapshotFromRows({ dbPath, stat, sources = [], dailyLimit, windowHours, timestamp, messages, sessions, parts = [] }) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const windowStartMs = timestamp - windowHours * 60 * 60 * 1000;
  const weekStartMs = timestamp - 7 * 24 * 60 * 60 * 1000;
  const partMap = agg.buildPartMap(parts);
  const perfLogs = typeof localProvider.scanUsageLogs === 'function'
    ? localProvider.scanUsageLogs()
    : { ttftEvents: localProvider.scanTtftLogs(), queueEvents: localProvider.scanQueueLogs() };
  const ttftEvents = perfLogs.ttftEvents || [];
  const ttftMap = agg.buildTtftMap(messages, ttftEvents);
  const queueEvents = perfLogs.queueEvents || [];
  const todayRows = messages.filter((m) => m.time_created >= dayStartMs);
  const windowRows = messages.filter((m) => m.time_created >= windowStartMs);
  const weekRows = messages.filter((m) => m.time_created >= weekStartMs);
  const today = agg.sumTokens(todayRows, partMap);
  const window = agg.sumTokens(windowRows, partMap);
  const week = agg.sumTokens(weekRows, partMap);
  const all = agg.sumTokens(messages, partMap);
  const requests = buildRequestRows(messages, sessions, partMap, ttftMap);
  const sessionUsage = agg.buildSessionUsageMap(messages, partMap, 0);
  const activeSessionCount = sessions.filter((s) => !s.time_archived).length;
  const archivedSessionCount = sessions.filter((s) => s.time_archived).length;
  const recentSessions = sessions
    .slice(0, 80)
    .map((s) => {
      const usage = sessionUsage.get(`${s.source || ''}:${s.id || ''}`) || { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, userTurns: 0, modelCalls: 0, errors: 0, models: [], topModel: null };
      return { id: s.id, title: s.title || '(无标题)', directory: s.directory, version: s.version, createdAt: s.time_created, updatedAt: s.time_updated, archivedAt: s.time_archived || null, age: timestamp - s.time_updated, archived: Boolean(s.time_archived), source: s.source, sourceLabel: s.sourceLabel, dbPath: s.dbPath, usage };
    });
  const errors = agg.latestErrors(messages, 10);
  const balance = agg.inferBalance(errors);
  const usagePercent = dailyLimit > 0 ? clamp((today.total / dailyLimit) * 100, 0, 999) : 0;
  const snap = {
    ok: true,
    app: '码道 Bar',
    timestamp,
    updatedAt: fmtTime(timestamp),
    dbPath,
    sources,
    dbSize: stat.size,
    config: { dailyLimit, windowHours },
    status: { label: `${Math.round(usagePercent)}%`, usagePercent, level: usagePercent >= 90 ? 'danger' : usagePercent >= 70 ? 'warning' : 'ok' },
    usage: { today, window, week, all },
    models: agg.modelStats(messages, weekStartMs, partMap, ttftMap).slice(0, 12),
    performance: { ttftEvents: ttftEvents.length, ttftMatched: ttftMap.size, today: agg.performanceStats(messages, partMap, dayStartMs, ttftMap), window: agg.performanceStats(messages, partMap, windowStartMs, ttftMap), week: agg.performanceStats(messages, partMap, weekStartMs, ttftMap), all: agg.performanceStats(messages, partMap, 0, ttftMap) },
    queue: { events: queueEvents.length, today: agg.queueStats(queueEvents, dayStartMs), window: agg.queueStats(queueEvents, windowStartMs), week: agg.queueStats(queueEvents, weekStartMs), all: agg.queueStats(queueEvents, 0), trends: agg.buildQueueTrends(queueEvents, timestamp) },
    requestLog: requests,
    sourceStats: aggregateBy(requests, (r) => r.sourceLabel || r.source),
    providerStats: aggregateBy(requests, (r) => r.provider),
    tools: { today: agg.toolStats(parts, dayStartMs), window: agg.toolStats(parts, windowStartMs), week: agg.toolStats(parts, weekStartMs), all: agg.toolStats(parts, 0) },
    trends: agg.buildTrends(messages, partMap, timestamp),
    sessions: recentSessions,
    sessionSummary: { total: sessions.length, active: activeSessionCount, archived: archivedSessionCount, visible: recentSessions.length },
    errors,
    balance,
    process: localProvider.detectProcesses(),
    codeartsConfig: localProvider.readCodeArtsConfig(),
    providers: listProviders(),
    freshness: { stale: false, source: 'live', ageMs: 0 },
  };
  snap.quota = buildQuota(snap, { timestamp, dailyLimit, windowHours });
  snap.health = buildHealth(snap, loadSettings());
  snap.status = { ...snap.status, resetAt: snap.quota.primary.resetAt, resetInMs: snap.quota.primary.resetInMs, remaining: snap.quota.primary.remaining };
  return snap;
}

function snapshotOptions(options = {}) {
  const settings = loadSettings();
  return {
    dailyLimit: Number(options.dailyLimit || settings.dailyLimit || process.env.CODEARTS_BAR_DAILY_LIMIT || DEFAULT_DAILY_LIMIT),
    windowHours: Number(options.windowHours || settings.windowHours || process.env.CODEARTS_BAR_WINDOW_HOURS || DEFAULT_WINDOW_HOURS),
    timestamp: nowMs(),
  };
}

function getSnapshot(options = {}) {
  const opts = snapshotOptions(options);
  const rows = localProvider.collectRowsNative(options);
  const snap = buildSnapshotFromRows({ dbPath: rows.dbPath, stat: rows.stat, sources: rows.sources, dailyLimit: opts.dailyLimit, windowHours: opts.windowHours, timestamp: opts.timestamp, messages: rows.messages, sessions: rows.sessions, parts: rows.parts });
  snap.adapter = rows.adapter;
  writeCache(snap);
  return snap;
}

async function getSnapshotAsync(options = {}) {
  const opts = snapshotOptions(options);
  const rows = await localProvider.collectRows(options);
  const snap = buildSnapshotFromRows({ dbPath: rows.dbPath, stat: rows.stat, sources: rows.sources, dailyLimit: opts.dailyLimit, windowHours: opts.windowHours, timestamp: opts.timestamp, messages: rows.messages, sessions: rows.sessions, parts: rows.parts });
  snap.adapter = rows.adapter;
  if (rows.nativeError) snap.nativeError = rows.nativeError;
  writeCache(snap);
  return snap;
}

async function getSnapshotWithCache(options = {}) {
  const key = JSON.stringify({ dbPath: options.dbPath || '', dailyLimit: options.dailyLimit || '', windowHours: options.windowHours || '' });
  return snapshotFlights.run(key, async () => {
  try {
    return await getSnapshotAsync(options);
  } catch (error) {
    if (!allowsSnapshotCacheFallback(options)) throw error;
    try {
      const cached = readCache();
      const snap = cached.snapshot;
      if (!isAutomaticSourceSnapshot(snap)) throw error;
      snap.ok = true;
      snap.freshness = { stale: true, source: 'cache', ageMs: Date.now() - (cached.savedAt || snap.timestamp || 0), error: error.message };
      return snap;
    } catch {
      throw error;
    }
  }
  });
}

function snapshotToText(snapshot) {
  if (!snapshot.ok) return `码道 Bar：${snapshot.error}`;
  const u = snapshot.usage;
  const lines = [];
  lines.push(`码道 Bar · 今日 ${snapshot.status.label}`);
  lines.push(`更新：${snapshot.updatedAt}`);
  lines.push(`今日：${fmtInt(u.today.total)} token（${u.today.messages} 次回复，${u.today.errors} 个错误）`);
  lines.push(`${snapshot.config.windowHours}h：${fmtInt(u.window.total)} token`);
  lines.push(`7d：${fmtInt(u.week.total)} token`);
  lines.push(`总计：${fmtInt(u.all.total)} token`);
  if (snapshot.performance && snapshot.performance.window) {
    const p = snapshot.performance.window;
    lines.push('性能：');
    lines.push(`  - 总等待均值：${fmtMs(p.latency.avg)} | P95：${fmtMs(p.latency.p95)} | P99：${fmtMs(p.latency.p99)}`);
    lines.push(`  - 首字时间：${fmtMs(p.ttft.avg)} | P95：${fmtMs(p.ttft.p95)} | 匹配：${snapshot.performance.ttftMatched}/${snapshot.performance.ttftEvents}`);
    lines.push(`  - 首事件近似：${fmtMs(p.firstEventApprox.avg)} | 首内容近似：${fmtMs(p.firstContentApprox.avg)}`);
    lines.push(`  - 输出速度：${Number.isFinite(p.outputTokensPerSec.avg) ? p.outputTokensPerSec.avg.toFixed(2) : '无数据'} token/s | 错误率：${(p.errorRate * 100).toFixed(1)}%`);
  }
  if (snapshot.queue && snapshot.queue.window) {
    lines.push(`排队时间：${snapshot.queue.window.samples ? `${fmtMs(snapshot.queue.window.avg)} 均值 / ${fmtMs(snapshot.queue.window.max)} 最大` : '无数据'}`);
  }
  if (snapshot.models.length) {
    lines.push('模型排行：');
    for (const m of snapshot.models.slice(0, 5)) lines.push(`  - ${m.model}: ${fmtInt(m.total)} token`);
  }
  if (snapshot.trends && snapshot.trends.hourly24h && snapshot.trends.hourly24h.length) {
    const last = snapshot.trends.hourly24h[snapshot.trends.hourly24h.length - 1];
    const max = snapshot.trends.hourly24h.reduce((m, b) => b.total > m.total ? b : m, snapshot.trends.hourly24h[0]);
    lines.push(`趋势：最近一小时 ${fmtInt(last.total)} token | 峰值小时 ${fmtInt(max.total)} token`);
  }
  if (snapshot.tools && snapshot.tools.window && snapshot.tools.window.byName.length) {
    lines.push('工具排行：');
    for (const t of snapshot.tools.window.byName.slice(0, 5)) lines.push(`  - ${t.name}: ${t.calls} 次调用${t.errors ? `，${t.errors} 个错误` : ''}`);
  }
  const activeSessions = (snapshot.sessions || []).filter((s) => !s.archived);
  if (activeSessions.length) {
    lines.push('最近会话：');
    for (const s of activeSessions.slice(0, 5)) lines.push(`  - ${s.title} · ${fmtDuration(s.age)} 前`);
  }
  return lines.join('\n');
}

function errorSnapshot(error, dbPath = resolveDbPath()) {
  return { ok: false, app: '码道 Bar', timestamp: nowMs(), updatedAt: fmtTime(nowMs()), dbPath, error: error && error.message ? error.message : String(error) };
}

module.exports = { DEFAULT_DB_PATH, getSnapshot, getSnapshotAsync, getSnapshotWithCache, snapshotToText, errorSnapshot, fmtInt, fmtDuration, fmtTime, fmtMs };

