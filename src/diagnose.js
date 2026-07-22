'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getSnapshotWithCache } = require('./codeartsData');
const { loadSettings, settingsPath, cachePath, officialStatsCachePath } = require('./settings');
const { officialStatsCacheStatus } = require('./officialStats');
const { buildUnifiedDiagnostics, pathSummary, sanitizeText } = require('./diagnostics-report');
const { findCodeArtsAgentExecutable } = require('./codearts-installation');

function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
function stat(file) { try { return fs.statSync(file); } catch { return null; } }
function run(command, args, timeout = 8000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, shell: false });
  return {
    ok: result.status === 0,
    status: Number.isInteger(result.status) ? result.status : null,
    stdout: String(result.stdout || '').slice(0, 2000),
    stderr: String(result.stderr || '').slice(0, 2000),
    error: result.error ? result.error.message : null,
  };
}

function scanLogs(root) {
  const result = { exists: exists(root), files: 0, firstTokenSignals: 0, requestLines: 0, root: pathSummary(root, fs, path) };
  if (!result.exists) return result;
  const patterns = [/first.token/i, /first[_ -]?chunk/i, /first[_ -]?delta/i, /ttft/i, /stream.*chunk/i, /response.*delta/i];
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.log')).slice(-120);
  result.files = files.length;
  for (const file of files) {
    const fullPath = path.join(root, file);
    const fileStat = stat(fullPath);
    if (!fileStat || fileStat.size > 5 * 1024 * 1024) continue;
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (/service=server "request"/.test(line)) result.requestLines += 1;
      if (patterns.some((pattern) => pattern.test(line))) result.firstTokenSignals += 1;
    }
  }
  return result;
}

function processSummary(result) {
  if (!result?.ok) return { ok: false, status: result?.status ?? null, error: sanitizeText(result?.error || result?.stderr || '') };
  let rows = [];
  try {
    const parsed = JSON.parse(result.stdout || '[]');
    rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {}
  return {
    ok: true,
    count: rows.length,
    names: [...new Set(rows.map((item) => sanitizeText(item?.ProcessName || '', 80)).filter(Boolean))].slice(0, 10),
  };
}

function cacheStatusSummary(status = {}) {
  return {
    exists: Boolean(status.exists),
    savedAt: status.savedAt || null,
    ageMs: Number(status.ageMs || 0),
    ok: Boolean(status.ok),
    days: Number(status.days || 0),
    sessions: Number(status.sessions || 0),
    messages: Number(status.messages || 0),
    file: pathSummary(status.path || '', fs, path),
  };
}

async function diagnose(options = {}) {
  const settings = loadSettings();
  const dbStat = stat(settings.dbPath);
  let snapshot = null;
  let snapshotError = null;
  try { snapshot = await getSnapshotWithCache(options.snapshotOptions || settings); }
  catch { snapshotError = true; }

  const agentExe = findCodeArtsAgentExecutable();
  const codeartsCli = path.join(os.homedir(), '.codeartsdoer', 'installers', 'codearts.cmd');
  const logRoot = path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'log');
  const configFile = path.join(os.homedir(), '.codeartsdoer', 'codearts_cli.json');
  const cliStats = exists(codeartsCli) ? run(codeartsCli, ['stats', '--help']) : { ok: false, error: 'not found' };
  const processes = processSummary(run('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object {$_.ProcessName -match 'codearts-agent|huawei-turbocontext'} | Select-Object ProcessName,Id | ConvertTo-Json -Compress"], 10000));
  const now = Number(options.now || process.env.CODEARTS_BAR_NOW_MS || Date.now());
  const report = {
    schemaVersion: 2,
    ok: Boolean(snapshot?.ok),
    generatedAt: new Date(now).toISOString(),
    database: {
      ...pathSummary(settings.dbPath, fs, path),
      size: dbStat?.size || 0,
      modifiedAt: dbStat ? dbStat.mtime.toISOString() : null,
    },
    snapshot: snapshot ? {
      stale: Boolean(snapshot.freshness?.stale),
      source: sanitizeText(snapshot.freshness?.source || 'live', 40),
      ageMs: Number(snapshot.freshness?.ageMs || 0),
      messages: Number(snapshot.usage?.all?.messages || 0),
      sessions: Number(snapshot.sessionSummary?.total || snapshot.sessions?.length || 0),
      models: Number(snapshot.models?.length || 0),
      hasPerformance: Boolean(snapshot.performance),
      hasTools: Boolean(snapshot.tools),
      ttftMatched: Number(snapshot.performance?.ttftMatched || 0),
      ttftEvents: Number(snapshot.performance?.ttftEvents || 0),
      providerCount: Number(snapshot.codeartsConfig?.providers?.length || 0),
      officialUsage: snapshot.officialUsage ? {
        ok: Boolean(snapshot.officialUsage.ok),
        status: sanitizeText(snapshot.officialUsage.status || '', 80),
        source: sanitizeText(snapshot.officialUsage.freshness?.source || snapshot.officialUsage.source || '', 80),
        ageMs: Number(snapshot.officialUsage.freshness?.ageMs || 0),
      } : null,
    } : null,
    snapshotError,
    codearts: {
      agent: { ...pathSummary(agentExe, fs, path), installed: exists(agentExe) },
      cli: {
        ...pathSummary(codeartsCli, fs, path),
        installed: exists(codeartsCli),
        statsHelpOk: Boolean(cliStats.ok),
        statsHelpStatus: cliStats.ok ? 'ok' : cliStats.error ? 'command_error' : 'command_failed',
      },
    },
    config: { ...pathSummary(configFile, fs, path), size: stat(configFile)?.size || 0 },
    officialStatsCache: cacheStatusSummary(officialStatsCacheStatus()),
    logs: scanLogs(logRoot),
    processes,
    recommendations: [],
  };
  if (!report.database.exists) report.recommendations.push('设置正确的 CodeArts opencode.db 路径。');
  if (snapshot?.freshness?.stale) report.recommendations.push('当前展示缓存数据；检查数据库是否被移动、锁定或仍在写入。');
  if (!report.logs.firstTokenSignals) report.recommendations.push('日志中没有可关联 first-token 的字段；TTFT 使用 part 表近似值。');
  if (!report.codearts.cli.statsHelpOk) report.recommendations.push('CodeArts CLI stats 需要配置官方统计凭据。');
  if (report.snapshot?.officialUsage?.source === 'stale-cache') report.recommendations.push('官方统计当前使用旧缓存；请检查凭据或网络状态。');
  report.unified = buildUnifiedDiagnostics({
    snapshot,
    database: { ok: report.database.exists, path: settings.dbPath, exists: report.database.exists, size: report.database.size },
    runtime: { status: processes.ok ? 'running-check-ok' : 'running-check-failed' },
    performance: null,
    paths: { database: settings.dbPath, settings: settingsPath(), cache: cachePath(), officialStatsCache: officialStatsCachePath(), logs: logRoot },
    fs,
    path,
    version: process.env.npm_package_version || '',
    now,
  });
  return report;
}

function reportToText(report) {
  const lines = [];
  lines.push(`CodeArts Bar Diagnose: ${report.ok ? 'OK' : 'ISSUE'}`);
  lines.push(`DB: ${report.database?.exists ? 'OK' : 'MISSING'} name=${report.database?.name || 'unknown'} size=${Number(report.database?.size || 0)} bytes`);
  if (report.snapshot) lines.push(`Snapshot: ${report.snapshot.source}${report.snapshot.stale ? ' stale' : ' live'} | messages=${report.snapshot.messages} sessions=${report.snapshot.sessions} models=${report.snapshot.models} perf=${report.snapshot.hasPerformance} tools=${report.snapshot.hasTools}`);
  lines.push(`Agent: ${report.codearts?.agent?.installed ? 'OK' : 'MISSING'}`);
  lines.push(`CLI: ${report.codearts?.cli?.installed ? 'OK' : 'MISSING'}`);
  lines.push(`Logs: files=${report.logs?.files || 0} first-token-signals=${report.logs?.firstTokenSignals || 0} requests=${report.logs?.requestLines || 0}`);
  lines.push(`Official cache: ${report.officialStatsCache?.exists ? 'OK' : 'MISSING'}`);
  if (report.recommendations?.length) {
    lines.push('Recommendations:');
    for (const recommendation of report.recommendations) lines.push(`  - ${sanitizeText(recommendation)}`);
  }
  return lines.join('\n');
}

module.exports = { cacheStatusSummary, diagnose, processSummary, reportToText, scanLogs };
