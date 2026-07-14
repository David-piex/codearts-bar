'use strict';

const { getSnapshotWithCache, snapshotToText, errorSnapshot } = require('./codeartsData');
const { diagnose, reportToText } = require('./diagnose');
const { loadSettings, saveSettings, settingsPath } = require('./settings');
const { getAuthStatus, authStatusToText } = require('./authStatus');
const { officialStatsCacheStatus } = require('./officialStats');
const { listProviders } = require('./providers');
const { sqliteRuntimeStatus } = require('./providers/codearts/sqlite');
const { jetbrainsPayload } = require('./jetbrains-payload');
const { queryPayload, databasePagePayload } = require('./protocol/query');
const { envelope, failure } = require('./protocol/envelope');
const { getSessionsPage, getRequestsPage, getSessionRequestsPage } = require('./providers/codearts/pagination');
const localProvider = require('./providers/codeartsLocal');
const { sanitizeText } = require('./diagnostics-report');

const cmd = process.argv[2] || 'snapshot';
const rest = process.argv.slice(3);

function parseSetArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--db') out.dbPath = args[++i];
    else if (a === '--daily-limit') out.dailyLimit = Number(args[++i]);
    else if (a === '--window-hours') out.windowHours = Number(args[++i]);
    else if (a === '--refresh-ms') out.refreshMs = Number(args[++i]);
    else if (a === '--official-stats-ttl-ms') out.officialStatsTtlMs = Number(args[++i]);
    else if (a === '--show-performance') out.showPerformance = args[++i] !== 'false';
    else if (a === '--show-tools') out.showTools = args[++i] !== 'false';
  }
  return out;
}

function readArg(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function selfTestOptions(args = []) {
  const dbPath = readArg(args, '--fixture-db');
  if (!dbPath) throw new Error('self-test requires --fixture-db <path>; real user databases are not allowed');
  const configDir = readArg(args, '--config-dir');
  if (!configDir) throw new Error('self-test requires --config-dir <temporary-directory>');
  const nowValue = Number(readArg(args, '--now-ms', process.env.CODEARTS_BAR_NOW_MS));
  if (!Number.isFinite(nowValue) || nowValue <= 0) throw new Error('self-test requires --now-ms <unix-milliseconds>');
  process.env.CODEARTS_BAR_DB = dbPath;
  process.env.CODEARTS_BAR_CONFIG_DIR = configDir;
  process.env.CODEARTS_BAR_NOW_MS = String(Math.trunc(nowValue));
  return { dbPath, timestamp: Math.trunc(nowValue), disableUsageLogs: true, fixtureMode: true, disableEnvironmentProbes: true, useSavedSettings: false };
}

function usageFromBuckets(buckets = []) {
  const fields = ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'messages', 'errors', 'cacheHitDenominator'];
  const usage = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const bucket of buckets || []) {
    for (const field of fields) usage[field] += Number(bucket?.[field] || 0);
  }
  usage.cacheHitRate = usage.cacheHitDenominator > 0 ? (usage.cacheRead / usage.cacheHitDenominator) * 100 : null;
  return usage;
}

async function run() {
  try {
    if (cmd === 'snapshot') {
      const snap = await getSnapshotWithCache();
      console.log(JSON.stringify(snap, null, 2));
      return;
    }
    if (cmd === 'query') {
      const resource = rest[0] || 'dashboard';
      const optionArgs = rest.slice(1);
      const readOption = (name, fallback = null) => { const index = optionArgs.indexOf(name); return index >= 0 ? optionArgs[index + 1] : fallback; };
      const page = Math.max(1, Math.trunc(Number(readOption('--page', 1)) || 1));
      const pageSize = Math.max(1, Math.min(500, Math.trunc(Number(readOption('--page-size', 50)) || 50)));
      const sessionId = readOption('--session-id');
      const source = readOption('--source');
      const query = readOption('--search', '');
      const start = Math.max(0, Number(readOption('--start', 0)) || 0);
      const end = Math.max(0, Number(readOption('--end', 0)) || 0);
      const range = { start, end };
      const pageOptions = { page, pageSize, sessionId, source, query, range };
      if (resource === 'analytics') {
        const bucketMs = Math.max(60000, Number(readOption('--bucket-ms', 3600000)) || 3600000);
        const bucketOffsetOption = readOption('--bucket-offset-ms');
        const bucketOffsetMs = bucketOffsetOption == null ? undefined : Number(bucketOffsetOption);
        const timestamp = end || Date.now();
        const aggregates = await localProvider.getDashboardAggregates({ source, range, timestamp, bucketMs, bucketOffsetMs });
        if (!aggregates?.ok) throw new Error(aggregates?.error || 'Unable to aggregate local usage data.');
        const buckets = Array.isArray(aggregates.buckets) ? aggregates.buckets : [];
        console.log(JSON.stringify(envelope({
          start: aggregates.start || start,
          end: aggregates.end || end,
          bucketMs: aggregates.bucketMs || bucketMs,
          bucketOffsetMs: aggregates.bucketOffsetMs ?? bucketOffsetMs ?? 0,
          usage: usageFromBuckets(buckets),
          trend: buckets,
          models: aggregates.modelStats || [],
          sources: aggregates.sourceStats || [],
        }, pageOptions), null, 2));
        return;
      }
      if (resource === 'sessions' || resource === 'requests') {
        const payload = { limit: pageSize, offset: (page - 1) * pageSize, query, source, range };
        const result = resource === 'sessions'
          ? await getSessionsPage({ ...payload, status: 'active' })
          : sessionId
            ? await getSessionRequestsPage({ ...payload, sessionId })
            : await getRequestsPage(payload);
        console.log(JSON.stringify(databasePagePayload(result, pageOptions), null, 2));
        return;
      }
      const snap = await getSnapshotWithCache();
      console.log(JSON.stringify(queryPayload(snap, resource, {
        ...pageOptions, requestId: readOption('--request-id'),
      }), null, 2));
      return;
    }
    if (cmd === 'jetbrains') {
      const snap = await getSnapshotWithCache();
      console.log(JSON.stringify(jetbrainsPayload(snap), null, 2));
      return;
    }
    if (cmd === 'stats') {
      const snap = await getSnapshotWithCache();
      console.log(snapshotToText(snap));
      return;
    }
    if (cmd === 'auth') {
      const json = rest.includes('--json');
      const status = getAuthStatus();
      console.log(json ? JSON.stringify(status, null, 2) : authStatusToText(status));
      return;
    }
    if (cmd === 'official-cache') {
      console.log(JSON.stringify(officialStatsCacheStatus(), null, 2));
      return;
    }
    if (cmd === 'providers') {
      console.log(JSON.stringify(listProviders(), null, 2));
      return;
    }
    if (cmd === 'runtime') {
      console.log(JSON.stringify({
        app: 'CodeArts Bar CLI',
        node: process.version,
        execPath: process.execPath,
        sqlite: sqliteRuntimeStatus(),
      }, null, 2));
      return;
    }
    if (cmd === 'diagnose' || cmd === 'doctor') {
      const json = rest.includes('--json');
      const report = await diagnose();
      console.log(json ? JSON.stringify(report, null, 2) : reportToText(report));
      return;
    }
    if (cmd === 'config') {
      const sub = rest[0] || 'show';
      if (sub === 'show') console.log(JSON.stringify({ path: settingsPath(), settings: loadSettings() }, null, 2));
      else if (sub === 'set') console.log(JSON.stringify(saveSettings(parseSetArgs(rest.slice(1))), null, 2));
      else throw new Error(`Unknown config subcommand: ${sub}`);
      return;
    }
    if (cmd === 'self-test') {
      const options = selfTestOptions(rest);
      const snap = await getSnapshotWithCache(options);
      if (!snap.ok) throw new Error(snap.error);
      const checks = [
        ['has db path', Boolean(snap.dbPath)],
        ['has usage', Boolean(snap.usage && snap.usage.all)],
        ['has sessions array', Array.isArray(snap.sessions)],
        ['has models array', Array.isArray(snap.models)],
        ['has performance', Boolean(snap.performance && snap.performance.window)],
        ['has tools stats', Boolean(snap.tools && snap.tools.window)],
        ['has quota/reset model', Boolean(snap.quota && snap.quota.primary && snap.quota.primary.resetAt)],
        ['has provider registry', Array.isArray(snap.providers) && snap.providers.length >= 3],
      ];
      for (const [name, ok] of checks) {
        console.log(`${ok ? 'ok' : 'fail'} - ${name}`);
        if (!ok) process.exitCode = 1;
      }
      console.log(`ok - fixture snapshot messages=${Number(snap.usage?.all?.messages || 0)} sessions=${Number(snap.sessionSummary?.total || 0)} requests=${Number(snap.requestLog?.length || 0)}`);
      return;
    }
    if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
      console.log(`CodeArts Bar CLI

Usage:
  codearts-bar snapshot             输出 JSON 快照
  codearts-bar stats                输出文本统计
  codearts-bar auth [--json]        查看 CLI/桌面端/DB 登录状态
  codearts-bar providers            查看 provider 注册表
  codearts-bar runtime              查看 Node / SQLite 运行时
  codearts-bar official-cache       查看官方 stats 缓存状态
  codearts-bar diagnose [--json]    诊断数据源/日志/缓存
  codearts-bar config show          查看配置
  codearts-bar config set --db <p> --daily-limit <n> --refresh-ms <n> --official-stats-ttl-ms <n>
  codearts-bar self-test --fixture-db <path> --config-dir <temp> --now-ms <ms>
                                    使用隔离 fixture 验证数据读取`);
      return;
    }
    console.error(`Unknown command: ${cmd}`);
    process.exitCode = 2;
  } catch (error) {
    const snap = errorSnapshot(error);
    if (cmd === 'snapshot') console.log(JSON.stringify(snap, null, 2));
    else if (cmd === 'query') console.log(JSON.stringify(failure(error), null, 2));
    else console.error(sanitizeText(snap.error));
    process.exitCode = 1;
  }
}

run();

module.exports = { readArg, selfTestOptions, usageFromBuckets };
