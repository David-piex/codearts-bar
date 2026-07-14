'use strict';

const agg = require('../../core/aggregator');
const nativeSql = require('./aggregation-sql');
const { getDatabaseDiagnostics } = require('./diagnostics');
const usageRollup = require('./usage-rollup');
const { aggregateCacheStats } = require('./aggregate-cache');
const {
  timeAggregateSync,
  timeAggregateAsync,
  aggregateError,
  sourceList,
  timeWindows,
  normalizeTrendRange,
  mergeSummaryParts,
  summaryFromDashboardBundle,
  trendFromDashboardBundle,
  sourceStatsFromDashboardBundle,
  modelStatsFromDashboardBundle,
  mergeBuckets,
  densifyBuckets,
  rebucketCalendarDays,
  mergeModelStats,
  mergeSessionSummaries,
  slowAggregateStats,
  resetSlowAggregateStats,
} = require('./aggregation-runtime');
const {
  runNativeAggregate,
  runSqlJsAggregate,
  queryAssistantRows,
  tokenUsageForRows,
  summaryWorker,
  modelStatsWorker,
  sessionSummaryForSource,
} = require('./aggregation-workers');

function getSummaryNative(payload = {}) {
  return timeAggregateSync('summary', 'node:sqlite', payload, () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'node:sqlite');
    if (rollupBundle) return summaryFromDashboardBundle(rollupBundle, payload);
    const windows = timeWindows(payload);
    const result = runNativeAggregate(payload, (args) => nativeSql.summaryForSourceSql({ ...args, payload, windows }));
    const merged = mergeSummaryParts(result.items, payload);
    if (result.errors.length) merged.sourceErrors = result.errors;
    return merged;
  });
}
async function getSummarySqlJs(payload = {}) {
  return timeAggregateAsync('summary', 'sql.js', payload, async () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'sql.js');
    if (rollupBundle) return summaryFromDashboardBundle(rollupBundle, payload);
    const result = await runSqlJsAggregate(payload, summaryWorker(payload));
    const merged = mergeSummaryParts(result.items, payload);
    if (result.errors.length) merged.sourceErrors = result.errors;
    return merged;
  });
}
async function getSummary(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSummaryNative(payload); }
    catch (error) { return aggregateError(error, await getSummarySqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getSummarySqlJs(payload));
}
function getTrendBucketsNative(payload = {}) {
  return timeAggregateSync('trendBuckets', 'node:sqlite', payload, () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'node:sqlite');
    if (rollupBundle) return trendFromDashboardBundle(rollupBundle, payload);
    const normalized = normalizeTrendRange(payload);
    const { start, end, bucketMs, bucketOffsetMs, timestamp } = normalized;
    const buckets = [];
    const queryTrendRange = { ...normalized, bucketMs: normalized.queryBucketMs, bucketOffsetMs: normalized.queryBucketOffsetMs };
    const result = runNativeAggregate(payload, (args) => nativeSql.trendForSourceSql({ ...args, payload, trendRange: queryTrendRange }));
    for (const arr of result.items) for (const b of arr) buckets.push(b);
    const rebucketed = normalized.calendarRebucket ? rebucketCalendarDays(mergeBuckets(buckets, normalized.queryBucketMs), normalized) : mergeBuckets(buckets, bucketMs);
    const merged = densifyBuckets(rebucketed, normalized);
    return { ok: true, timestamp, start, end, bucketMs, bucketOffsetMs, buckets: merged, sourceErrors: result.errors };
  });
}
async function getTrendBucketsSqlJs(payload = {}) {
  return timeAggregateAsync('trendBuckets', 'sql.js', payload, async () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'sql.js');
    if (rollupBundle) return trendFromDashboardBundle(rollupBundle, payload);
    const normalized = normalizeTrendRange(payload);
    const { start, end, bucketMs, bucketOffsetMs, timestamp } = normalized;
    const buckets = [];
    const result = await runSqlJsAggregate(payload, ({ source, db, tables, queryAll }) => {
      const rows = queryAssistantRows(queryAll, db, source, payload, start, end);
      const { partMap } = tokenUsageForRows(queryAll, db, source, tables, rows);
      return agg.trendStats(rows, partMap, start, normalized.queryBucketMs, normalized.queryBucketOffsetMs);
    });
    for (const arr of result.items) for (const b of arr) buckets.push(b);
    const rebucketed = normalized.calendarRebucket ? rebucketCalendarDays(mergeBuckets(buckets, normalized.queryBucketMs), normalized) : mergeBuckets(buckets, bucketMs);
    const merged = densifyBuckets(rebucketed, normalized);
    return { ok: true, timestamp, start, end, bucketMs, bucketOffsetMs, buckets: merged, sourceErrors: result.errors };
  });
}
async function getTrendBuckets(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getTrendBucketsNative(payload); }
    catch (error) { return aggregateError(error, await getTrendBucketsSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getTrendBucketsSqlJs(payload));
}
function getSourceStatsNative(payload = {}) {
  return timeAggregateSync('sourceStats', 'node:sqlite', payload, () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'node:sqlite');
    if (rollupBundle) return sourceStatsFromDashboardBundle(rollupBundle, payload);
    const result = runNativeAggregate(payload, (args) => nativeSql.sourceStatForSourceSql({ ...args, payload }));
    return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items.sort((a, b) => b.total - a.total), sourceErrors: result.errors };
  });
}
async function getSourceStatsSqlJs(payload = {}) {
  return timeAggregateAsync('sourceStats', 'sql.js', payload, async () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'sql.js');
    if (rollupBundle) return sourceStatsFromDashboardBundle(rollupBundle, payload);
    const result = await runSqlJsAggregate(payload, (args) => nativeSql.sourceStatForSourceSql({ ...args, payload }));
    return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items.sort((a, b) => b.total - a.total), sourceErrors: result.errors };
  });
}
async function getSourceStats(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSourceStatsNative(payload); }
    catch (error) { return aggregateError(error, await getSourceStatsSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getSourceStatsSqlJs(payload));
}
function getModelStatsNative(payload = {}) {
  return timeAggregateSync('modelStats', 'node:sqlite', payload, () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'node:sqlite');
    if (rollupBundle) return modelStatsFromDashboardBundle(rollupBundle, payload);
    const result = runNativeAggregate(payload, (args) => nativeSql.modelStatsForSourceSql({ ...args, payload }));
    return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: mergeModelStats(result.items), sourceErrors: result.errors };
  });
}
async function getModelStatsSqlJs(payload = {}) {
  return timeAggregateAsync('modelStats', 'sql.js', payload, async () => {
    const rollupBundle = dashboardBundleFromUsageRollups(payload, 'sql.js');
    if (rollupBundle) return modelStatsFromDashboardBundle(rollupBundle, payload);
    const result = await runSqlJsAggregate(payload, modelStatsWorker(payload));
    return { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: mergeModelStats(result.items), sourceErrors: result.errors };
  });
}
async function getModelStats(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getModelStatsNative(payload); }
    catch (error) { return aggregateError(error, await getModelStatsSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getModelStatsSqlJs(payload));
}
function getSessionSummaryNative(payload = {}) {
  return timeAggregateSync('sessionSummary', 'node:sqlite', payload, () => {
    const rollupSummary = sessionSummaryFromUsageRollups(payload, 'node:sqlite');
    if (rollupSummary) return rollupSummary;
    const result = runNativeAggregate(payload, (args) => nativeSql.sessionSummaryForSourceSql({ ...args, payload }));
    return mergeSessionSummaries(result.items, payload, result.errors);
  });
}
async function getSessionSummarySqlJs(payload = {}) {
  return timeAggregateAsync('sessionSummary', 'sql.js', payload, async () => {
    const rollupSummary = sessionSummaryFromUsageRollups(payload, 'sql.js');
    if (rollupSummary) return rollupSummary;
    const result = await runSqlJsAggregate(payload, (args) => nativeSql.sessionSummaryForSourceSql({ ...args, payload }));
    return mergeSessionSummaries(result.items, payload, result.errors);
  });
}
async function getSessionSummary(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSessionSummaryNative(payload); }
    catch (error) { return aggregateError(error, await getSessionSummarySqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getSessionSummarySqlJs(payload));
}
function mergeDashboardAggregateBundle(items = [], payload = {}, errors = []) {
  const trendRange = normalizeTrendRange(payload);
  const summary = mergeSummaryParts(items.map((x) => x.summary), payload);
  const sessionSummary = mergeSessionSummaries(items.map((x) => x.sessionSummary).filter(Boolean), payload, errors);
  const mergedTrendBuckets = mergeBuckets(items.flatMap((x) => x.trendBuckets || []), trendRange.queryBucketMs || trendRange.bucketMs);
  const buckets = densifyBuckets(trendRange.calendarRebucket ? rebucketCalendarDays(mergedTrendBuckets, trendRange) : mergedTrendBuckets, trendRange);
  const sourceStats = items.map((x) => x.sourceStat).filter(Boolean).sort((a, b) => b.total - a.total);
  const modelStats = mergeModelStats(items.map((x) => x.modelStats || []));
  const rollups = items.map((x) => x.usageRollup).filter(Boolean);
  const out = {
    ok: true,
    timestamp: Number(payload.timestamp || Date.now()),
    start: trendRange.start,
    end: trendRange.end,
    bucketMs: trendRange.bucketMs,
    bucketOffsetMs: trendRange.bucketOffsetMs,
    usage: summary.usage,
    sources: summary.sources,
    buckets,
    sourceStats,
    modelStats,
    sessionSummary,
    sourceErrors: errors,
  };
  if (rollups.length) {
    out.perf = {
      usageRollup: {
        enabled: true,
        sources: rollups.length,
        hits: rollups.filter((x) => x.status === 'hit' || x.status === 'compact-hit').length,
        compactHits: rollups.filter((x) => x.status === 'compact-hit').length,
        rebuilt: rollups.filter((x) => x.status === 'rebuilt' || x.status === 'miss').length,
        statuses: rollups.map((x) => ({
          status: x.status,
          previousReason: x.previousReason || null,
          rowCount: x.rowCount ?? null,
          compactBuckets: x.compactBuckets ?? null,
          sessionStatus: x.session?.status || null,
          sessionRows: x.session?.rowCount ?? null,
        })),
      },
    };
  }
  return out;
}
function sessionSummaryFromUsageRollups(payload = {}, adapter = 'node:sqlite', sources = null) {
  if (!usageRollup.canUseSessionSummaryRollup(payload)) return null;
  const selectedSources = sources || sourceList(payload);
  if (!selectedSources.length) return null;
  const items = [];
  const statuses = [];
  for (const source of selectedSources) {
    const rollup = usageRollup.readSessionSummaryRollupForSource(source);
    if (!rollup.ok) {
      usageRollup.scheduleUsageRollupBuild(source, { adapter, delayMs: 500 });
      return null;
    }
    items.push(usageRollup.sessionSummaryPartFromRollup(rollup, payload));
    statuses.push({
      status: rollup.usageRollup?.status || 'session-hit',
      rowCount: rollup.usageRollup?.rowCount ?? rollup.sessions?.length ?? null,
    });
  }
  const merged = mergeSessionSummaries(items, payload, []);
  merged.perf = {
    usageRollup: {
      enabled: true,
      sources: selectedSources.length,
      hits: items.length,
      sessionHits: items.length,
      statuses,
    },
  };
  return merged;
}
function attachSessionSummaryFromRollupOrSql(part, args, payload = {}, adapter = 'node:sqlite') {
  if (!part.sessionSummary && usageRollup.canUseSessionSummaryRollup(payload)) {
    const sessionRollup = usageRollup.readSessionSummaryRollupForSource(args.source);
    if (sessionRollup.ok) {
      part.sessionSummary = usageRollup.sessionSummaryPartFromRollup(sessionRollup, payload);
      part.usageRollup = {
        ...(part.usageRollup || {}),
        session: {
          status: sessionRollup.usageRollup?.status || 'session-hit',
          rowCount: sessionRollup.usageRollup?.rowCount ?? sessionRollup.sessions?.length ?? null,
        },
      };
      return part;
    }
    usageRollup.scheduleUsageRollupBuild(args.source, { adapter, delayMs: 500 });
  }
  if (!part.sessionSummary) {
    if (!args.db || typeof args.queryAll !== 'function') return part;
    part.sessionSummary = nativeSql.sessionSummaryForSourceSql({ ...args, payload });
  }
  return part;
}
function dashboardBundleFromUsageRollups(payload = {}, adapter = 'node:sqlite', sources = null) {
  if (!usageRollup.canUseUsageRollup(payload)) return null;
  const selectedSources = sources || sourceList(payload);
  if (!selectedSources.length) return null;
  const windows = timeWindows(payload);
  const trendRange = normalizeTrendRange(payload);
  if (trendRange.calendarRebucket) return null;
  const items = [];
  const misses = [];
  for (const source of selectedSources) {
    const compact = usageRollup.readCompactUsageRollupForSource(source);
    if (compact.ok && usageRollup.compactRollupIsSafeForDashboard(compact, { payload, windows, trendRange })) {
      const part = usageRollup.dashboardPartFromCompactRollup(compact, { payload, windows, trendRange });
      attachSessionSummaryFromRollupOrSql(part, { source, db: null, tables: [], queryAll: null }, payload, adapter);
      items.push(part);
      continue;
    }
    const rollup = usageRollup.readUsageRollupForSource(source);
    if (rollup.ok) {
      const part = usageRollup.dashboardPartFromUsageRollup(rollup, { payload, windows, trendRange });
      attachSessionSummaryFromRollupOrSql(part, { source, db: null, tables: [], queryAll: null }, payload, adapter);
      items.push(part);
      continue;
    }
    misses.push({ source: source.id, reason: rollup.reason || compact.reason || 'missing' });
    usageRollup.scheduleUsageRollupBuild(source, { adapter, delayMs: 500 });
  }
  if (misses.length) return null;
  const bundle = mergeDashboardAggregateBundle(items, payload, []);
  bundle.rollupFastPath = true;
  return bundle;
}
function getDashboardAggregatesNative(payload = {}) {
  return timeAggregateSync('dashboardAggregates', 'node:sqlite', payload, () => {
    const windows = timeWindows(payload);
    const trendRange = normalizeTrendRange(payload);
    const queryTrendRange = { ...trendRange, bucketMs: trendRange.queryBucketMs, bucketOffsetMs: trendRange.queryBucketOffsetMs };
    const result = runNativeAggregate(payload, (args) => {
      if (usageRollup.canUseUsageRollup(payload)) {
        const compact = usageRollup.readCompactUsageRollupForSource(args.source);
        if (compact.ok && usageRollup.compactRollupIsSafeForDashboard(compact, { payload, windows, trendRange })) {
          const part = usageRollup.dashboardPartFromCompactRollup(compact, { payload, windows, trendRange });
          return attachSessionSummaryFromRollupOrSql(part, args, payload, 'node:sqlite');
        }
        const rollup = usageRollup.readUsageRollupForSource(args.source);
        if (rollup.ok) {
          const part = usageRollup.dashboardPartFromUsageRollup(rollup, { payload, windows, trendRange });
          return attachSessionSummaryFromRollupOrSql(part, args, payload, 'node:sqlite');
        }
        const part = nativeSql.aggregateBundleForSourceSql({ ...args, payload, windows, trendRange: queryTrendRange });
        usageRollup.scheduleUsageRollupBuild(args.source, { adapter: 'node:sqlite', delayMs: 500 });
        part.usageRollup = { status: 'miss-pass-through', previousReason: rollup.reason || null, rowCount: null };
        return part;
      }
      return nativeSql.aggregateBundleForSourceSql({ ...args, payload, windows, trendRange: queryTrendRange });
    });
    return mergeDashboardAggregateBundle(result.items, payload, result.errors);
  });
}
async function getDashboardAggregatesSqlJs(payload = {}) {
  return timeAggregateAsync('dashboardAggregates', 'sql.js', payload, async () => {
    const windows = timeWindows(payload);
    const trendRange = normalizeTrendRange(payload);
    const queryTrendRange = { ...trendRange, bucketMs: trendRange.queryBucketMs, bucketOffsetMs: trendRange.queryBucketOffsetMs };
    const result = await runSqlJsAggregate(payload, (args) => {
      if (usageRollup.canUseUsageRollup(payload)) {
        const compact = usageRollup.readCompactUsageRollupForSource(args.source);
        if (compact.ok && usageRollup.compactRollupIsSafeForDashboard(compact, { payload, windows, trendRange })) {
          const part = usageRollup.dashboardPartFromCompactRollup(compact, { payload, windows, trendRange });
          return attachSessionSummaryFromRollupOrSql(part, args, payload, 'sql.js');
        }
        const rollup = usageRollup.readUsageRollupForSource(args.source);
        if (rollup.ok) {
          const part = usageRollup.dashboardPartFromUsageRollup(rollup, { payload, windows, trendRange });
          return attachSessionSummaryFromRollupOrSql(part, args, payload, 'sql.js');
        }
        const part = nativeSql.aggregateBundleForSourceSql({ ...args, payload, windows, trendRange: queryTrendRange });
        usageRollup.scheduleUsageRollupBuild(args.source, { adapter: 'sql.js', delayMs: 500 });
        part.usageRollup = { status: 'miss-pass-through', previousReason: rollup.reason || null, rowCount: null };
        return part;
      }
      return nativeSql.aggregateBundleForSourceSql({ ...args, payload, windows, trendRange: queryTrendRange });
    });
    return mergeDashboardAggregateBundle(result.items, payload, result.errors);
  });
}
async function getDashboardAggregates(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getDashboardAggregatesNative(payload); }
    catch (error) { return aggregateError(error, await getDashboardAggregatesSqlJs(payload)); }
  }
  return aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getDashboardAggregatesSqlJs(payload));
}
function getDatabaseHealthNative(payload = {}) {
  return timeAggregateSync('databaseHealth', 'node:sqlite', payload, () => {
    const result = runNativeAggregate(payload, ({ source, db, tables, queryAll }) => {
      const quick = queryAll(db, 'pragma quick_check(1)', []);
      const messageCount = queryAll(db, 'select count(*) as count from message', [])[0]?.count || 0;
      const sessionCount = queryAll(db, 'select count(*) as count from session', [])[0]?.count || 0;
      return { source: source.id, label: source.label, dbPath: source.dbPath, ok: true, quickCheck: Object.values(quick[0] || {})[0] || 'ok', tables, messageCount, sessionCount };
    });
    const health = { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items, sourceErrors: result.errors };
    health.diagnostics = getDatabaseDiagnostics(payload, health);
    return health;
  });
}
async function getDatabaseHealthSqlJs(payload = {}) {
  return timeAggregateAsync('databaseHealth', 'sql.js', payload, async () => {
    const result = await runSqlJsAggregate(payload, ({ source, db, tables, queryAll }) => {
      const quick = queryAll(db, 'pragma quick_check(1)', []);
      const messageCount = queryAll(db, 'select count(*) as count from message', [])[0]?.count || 0;
      const sessionCount = queryAll(db, 'select count(*) as count from session', [])[0]?.count || 0;
      return { source: source.id, label: source.label, dbPath: source.dbPath, ok: true, quickCheck: Object.values(quick[0] || {})[0] || 'ok', tables, messageCount, sessionCount };
    });
    const health = { ok: true, timestamp: Number(payload.timestamp || Date.now()), items: result.items, sourceErrors: result.errors };
    health.diagnostics = getDatabaseDiagnostics(payload, health);
    return health;
  });
}
async function getDatabaseHealth(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getDatabaseHealthNative(payload); }
    catch (error) {
      const health = aggregateError(error, await getDatabaseHealthSqlJs(payload));
      health.diagnostics = getDatabaseDiagnostics(payload, health);
      return health;
    }
  }
  const health = aggregateError('CODEARTS_BAR_FORCE_SQLJS=1', await getDatabaseHealthSqlJs(payload));
  health.diagnostics = getDatabaseDiagnostics(payload, health);
  return health;
}

module.exports = {
  getSummary,
  getSummaryNative,
  getSummarySqlJs,
  getTrendBuckets,
  getTrendBucketsNative,
  getTrendBucketsSqlJs,
  getSourceStats,
  getSourceStatsNative,
  getSourceStatsSqlJs,
  getModelStats,
  getModelStatsNative,
  getModelStatsSqlJs,
  getSessionSummary,
  getSessionSummaryNative,
  getSessionSummarySqlJs,
  getDashboardAggregates,
  getDashboardAggregatesNative,
  getDashboardAggregatesSqlJs,
  getDatabaseHealth,
  getDatabaseHealthNative,
  getDatabaseHealthSqlJs,
  aggregateCacheStats,
  usageRollupStats: usageRollup.usageRollupStats,
  slowAggregateStats,
  resetSlowAggregateStats,
};
