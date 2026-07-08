'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getSnapshotWithCache } = require('./codeartsData');
const { loadSettings, settingsPath, cachePath, officialStatsCachePath } = require('./settings');
const { officialStatsCacheStatus } = require('./officialStats');

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function stat(p) { try { return fs.statSync(p); } catch { return null; } }
function run(cmd, args, timeout = 8000) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, shell: false });
  return { ok: r.status === 0, status: r.status, stdout: (r.stdout || '').slice(0, 2000), stderr: (r.stderr || '').slice(0, 2000), error: r.error ? r.error.message : null };
}
function scanLogs(root) {
  const result = { path: root, exists: exists(root), files: 0, firstTokenSignals: [], requestLines: 0 };
  if (!result.exists) return result;
  const patterns = [/first.token/i, /first[_ -]?chunk/i, /first[_ -]?delta/i, /ttft/i, /stream.*chunk/i, /response.*delta/i];
  const files = fs.readdirSync(root).filter((f) => f.endsWith('.log')).slice(-120);
  result.files = files.length;
  for (const f of files) {
    const fp = path.join(root, f);
    const st = stat(fp);
    if (!st || st.size > 5 * 1024 * 1024) continue;
    const text = fs.readFileSync(fp, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/service=server "request"/.test(line)) result.requestLines += 1;
      if (patterns.some((p) => p.test(line))) result.firstTokenSignals.push({ file: f, line: i + 1, text: line.slice(0, 240) });
      if (result.firstTokenSignals.length >= 20) return result;
    }
  }
  return result;
}
async function diagnose() {
  const settings = loadSettings();
  const dbStat = stat(settings.dbPath);
  let snapshot = null; let snapshotError = null;
  try { snapshot = await getSnapshotWithCache(settings); } catch (e) { snapshotError = e.message; }
  const agentExe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'CodeArts Agent', 'codearts-agent.exe');
  const codeartsCli = path.join(os.homedir(), '.codeartsdoer', 'installers', 'codearts.cmd');
  const logRoot = path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'log');
  const configFile = path.join(os.homedir(), '.codeartsdoer', 'codearts_cli.json');
  const cliStats = exists(codeartsCli) ? run(codeartsCli, ['stats', '--help']) : { ok: false, error: 'not found' };
  const processes = run('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object {$_.ProcessName -match 'codearts-agent|huawei-turbocontext'} | Select-Object ProcessName,Id,Path | ConvertTo-Json -Compress"], 10000);
  const report = {
    ok: Boolean(snapshot && snapshot.ok),
    generatedAt: new Date().toISOString(),
    settings: { ...settings, settingsPath: settingsPath(), cachePath: cachePath(), officialStatsCachePath: officialStatsCachePath() },
    db: { path: settings.dbPath, exists: Boolean(dbStat), size: dbStat ? dbStat.size : 0, modifiedAt: dbStat ? dbStat.mtime.toISOString() : null },
    snapshot: snapshot ? { stale: snapshot.freshness?.stale || false, source: snapshot.freshness?.source || 'live', ageMs: snapshot.freshness?.ageMs || 0, messages: snapshot.usage?.all?.messages, sessions: snapshot.sessions?.length, models: snapshot.models?.length, hasPerformance: Boolean(snapshot.performance), hasTools: Boolean(snapshot.tools), hasBalanceHint: Boolean(snapshot.balance), ttftMatched: snapshot.performance?.ttftMatched, ttftEvents: snapshot.performance?.ttftEvents, providers: snapshot.codeartsConfig?.providers?.length, officialQuota: snapshot.codeartsConfig?.officialQuota, officialUsage: snapshot.officialUsage ? { ok: snapshot.officialUsage.ok, status: snapshot.officialUsage.status, source: snapshot.officialUsage.freshness?.source || snapshot.officialUsage.source, ageMs: snapshot.officialUsage.freshness?.ageMs || 0, input: snapshot.officialUsage.input, output: snapshot.officialUsage.output } : null } : null,
    snapshotError,
    codearts: { agentExe: { path: agentExe, exists: exists(agentExe) }, cli: { path: codeartsCli, exists: exists(codeartsCli), statsHelpOk: cliStats.ok, statsHelpError: cliStats.error || cliStats.stderr } },
    config: { path: configFile, exists: exists(configFile), size: stat(configFile)?.size || 0 },
    officialStatsCache: officialStatsCacheStatus(),
    logs: scanLogs(logRoot),
    processes: processes.ok ? processes.stdout : processes.stderr || processes.error,
    recommendations: [],
  };
  if (!report.db.exists) report.recommendations.push('设置正确的 CodeArts opencode.db 路径。');
  if (snapshot && snapshot.freshness?.stale) report.recommendations.push('当前展示缓存数据；检查 DB 是否被移动、锁定或 CodeArts 是否仍在写入。');
  if (!report.logs.firstTokenSignals.length) report.recommendations.push('未在日志中发现可关联 first-token 的字段；TTFT 仍使用 part 表近似值。');
  if (!report.codearts.cli.statsHelpOk) report.recommendations.push('CodeArts CLI stats 需要 CODEARTS_CLI_AK/CODEARTS_CLI_SK 才能查询官方统计。');
  if (report.snapshot?.officialUsage?.source === 'stale-cache') report.recommendations.push('官方统计当前使用旧缓存；检查 AK/SK 环境变量或 CodeArts CLI 网络状态。');
  return report;
}
function reportToText(r) {
  const lines = [];
  lines.push(`CodeArts Bar Diagnose: ${r.ok ? 'OK' : 'ISSUE'}`);
  lines.push(`DB: ${r.db.exists ? 'OK' : 'MISSING'} ${r.db.path} (${r.db.size} bytes)`);
  if (r.snapshot) lines.push(`Snapshot: ${r.snapshot.source}${r.snapshot.stale ? ' stale' : ' live'} | messages=${r.snapshot.messages} models=${r.snapshot.models} perf=${r.snapshot.hasPerformance} tools=${r.snapshot.hasTools} ttft=${r.snapshot.ttftMatched}/${r.snapshot.ttftEvents} providers=${r.snapshot.providers}`);
  lines.push(`Agent exe: ${r.codearts.agentExe.exists ? 'OK' : 'MISSING'} ${r.codearts.agentExe.path}`);
  lines.push(`CLI: ${r.codearts.cli.exists ? 'OK' : 'MISSING'} ${r.codearts.cli.path}`);
  lines.push(`Logs: files=${r.logs.files} first-token-signals=${r.logs.firstTokenSignals.length} requests=${r.logs.requestLines}`);
  if (r.snapshot && r.snapshot.officialUsage) lines.push(`Official stats: ${r.snapshot.officialUsage.ok ? 'OK' : r.snapshot.officialUsage.status} source=${r.snapshot.officialUsage.source || 'n/a'} age=${Math.round((r.snapshot.officialUsage.ageMs || 0) / 1000)}s`);
  lines.push(`Official cache: ${r.officialStatsCache.exists ? 'OK' : 'MISSING'} ${r.officialStatsCache.path}`);
  if (r.snapshot && r.snapshot.officialQuota) lines.push(`Official quota: ${r.snapshot.officialQuota.status}`);
  if (r.recommendations.length) { lines.push('Recommendations:'); for (const x of r.recommendations) lines.push(`  - ${x}`); }
  return lines.join('\n');
}
module.exports = { diagnose, reportToText };
