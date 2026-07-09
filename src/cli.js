'use strict';

const { getSnapshotWithCache, snapshotToText, errorSnapshot } = require('./codeartsData');
const { diagnose, reportToText } = require('./diagnose');
const { loadSettings, saveSettings, settingsPath } = require('./settings');
const { getAuthStatus, authStatusToText } = require('./authStatus');
const { officialStatsCacheStatus } = require('./officialStats');
const { listProviders } = require('./providers');
const { sqliteRuntimeStatus } = require('./providers/codearts/sqlite');

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

async function run() {
  try {
    if (cmd === 'snapshot') {
      const snap = await getSnapshotWithCache();
      console.log(JSON.stringify(snap, null, 2));
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
      const snap = await getSnapshotWithCache();
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
      console.log(snapshotToText(snap));
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
  codearts-bar self-test            验证本地数据读取`);
      return;
    }
    console.error(`Unknown command: ${cmd}`);
    process.exitCode = 2;
  } catch (error) {
    const snap = errorSnapshot(error);
    if (cmd === 'snapshot') console.log(JSON.stringify(snap, null, 2));
    else console.error(snap.error);
    process.exitCode = 1;
  }
}

run();
