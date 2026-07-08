'use strict';

const { spawnSync } = require('node:child_process');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { configDir, officialStatsCachePath, loadSettings } = require('./settings');

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}
function parseHumanNumber(text) {
  if (!text) return null;
  const m = String(text).trim().match(/\$?\s*([0-9]+(?:\.[0-9]+)?)([KMB])?/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || '').toUpperCase();
  return unit === 'K' ? n * 1e3 : unit === 'M' ? n * 1e6 : unit === 'B' ? n * 1e9 : n;
}
function lineValue(lines, label) {
  const re = new RegExp(`^\\s*${label}\\s+(.+?)\\s*$`, 'i');
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}
function parseStatsOutput(stdout) {
  const text = stripAnsi(stdout);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[│┌┐└┘├┤─]/g, ' ').trim()).filter(Boolean);
  const models = [];
  let current = null;
  for (const line of lines) {
    if (/^(OVERVIEW|COST & TOKENS|MODEL USAGE)$/i.test(line)) continue;
    const modelMatch = line.match(/^(huaweicloud[^\s]+|[\w.-]+\/[\w./-]+)$/i);
    if (modelMatch && !/^(Messages|Input|Output|Cache|Cost|Sessions|Days|Total|Avg|Median)/i.test(line)) {
      current = { name: line };
      models.push(current);
      continue;
    }
    if (current) {
      let m;
      if ((m = line.match(/^Messages\s+(.+)$/i))) current.messages = parseHumanNumber(m[1]);
      else if ((m = line.match(/^Input Tokens\s+(.+)$/i))) current.input = parseHumanNumber(m[1]);
      else if ((m = line.match(/^Output Tokens\s+(.+)$/i))) current.output = parseHumanNumber(m[1]);
      else if ((m = line.match(/^Cache Read\s+(.+)$/i))) current.cacheRead = parseHumanNumber(m[1]);
      else if ((m = line.match(/^Cache Write\s+(.+)$/i))) current.cacheWrite = parseHumanNumber(m[1]);
      else if ((m = line.match(/^Cost\s+\$?(.+)$/i))) current.cost = Number(m[1]);
    }
  }
  return {
    sessions: parseHumanNumber(lineValue(lines, 'Sessions')),
    messages: parseHumanNumber(lineValue(lines, 'Messages')),
    days: parseHumanNumber(lineValue(lines, 'Days')),
    totalCost: parseHumanNumber((lineValue(lines, 'Total Cost') || '').replace('$', '')),
    avgCostPerDay: parseHumanNumber((lineValue(lines, 'Avg Cost/Day') || '').replace('$', '')),
    avgTokensPerSession: parseHumanNumber(lineValue(lines, 'Avg Tokens/Session')),
    medianTokensPerSession: parseHumanNumber(lineValue(lines, 'Median Tokens/Session')),
    input: parseHumanNumber(lineValue(lines, 'Input')),
    output: parseHumanNumber(lineValue(lines, 'Output')),
    cacheRead: parseHumanNumber(lineValue(lines, 'Cache Read')),
    cacheWrite: parseHumanNumber(lineValue(lines, 'Cache Write')),
    models,
    rawText: text,
  };
}
function readOfficialStatsCache() {
  try {
    const data = JSON.parse(fs.readFileSync(officialStatsCachePath(), 'utf8').replace(/^\uFEFF/, ''));
    if (!data || !data.stats) return null;
    return data;
  } catch {
    return null;
  }
}
function writeOfficialStatsCache(stats) {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(officialStatsCachePath(), JSON.stringify({ savedAt: Date.now(), stats }, null, 2), 'utf8');
  } catch {}
}
function markCacheMeta(stats, cache, source) {
  if (!stats) return stats;
  return {
    ...stats,
    freshness: {
      stale: source === 'stale-cache',
      source,
      ageMs: cache && cache.savedAt ? Date.now() - cache.savedAt : 0,
      savedAt: cache && cache.savedAt ? new Date(cache.savedAt).toISOString() : null,
    },
  };
}
function unavailable(status, extra = {}) {
  return { available: false, ok: false, status, ...extra };
}
function fetchOfficialStats(options = {}) {
  const available = Boolean(process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK);
  if (!available) return unavailable('missing_CODEARTS_CLI_AK_SK');
  const days = String(options.days || 7);
  let result;
  if (process.platform === 'win32') {
    const cmd = `codearts stats --days ${days} --models 20 --tools 20`;
    result = spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: options.timeoutMs || 30000, windowsHide: true, env: process.env });
  } else {
    result = spawnSync('codearts', ['stats', '--days', days, '--models', '20', '--tools', '20'], { encoding: 'utf8', timeout: options.timeoutMs || 30000, windowsHide: true, env: process.env });
  }
  if (result.status !== 0) {
    return { available: true, ok: false, status: result.error ? 'command_error' : 'command_failed', exitCode: result.status, error: result.error ? result.error.message : null, stderr: stripAnsi(result.stderr), stdout: stripAnsi(result.stdout) };
  }
  return { available: true, ok: true, status: 'ok', source: 'codearts stats', days: Number(days), ...parseStatsOutput(result.stdout) };
}
function fetchOfficialStatsAsync(options = {}) {
  return new Promise((resolve) => {
    const available = Boolean(process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK);
    if (!available) return resolve(unavailable('missing_CODEARTS_CLI_AK_SK'));
    const days = String(options.days || 7);
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-Command', `codearts stats --days ${days} --models 20 --tools 20`]
      : ['stats', '--days', days, '--models', '20', '--tools', '20'];
    const cmd = process.platform === 'win32' ? 'powershell.exe' : 'codearts';
    const child = spawn(cmd, args, { windowsHide: true, env: process.env });
    let stdout = ''; let stderr = ''; let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ available: true, ok: false, status: 'timeout', stderr: stripAnsi(stderr), stdout: stripAnsi(stdout) }); } }, options.timeoutMs || 30000);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (error) => { if (!done) { done = true; clearTimeout(timer); resolve({ available: true, ok: false, status: 'command_error', error: error.message, stderr: stripAnsi(stderr), stdout: stripAnsi(stdout) }); } });
    child.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (code !== 0) return resolve({ available: true, ok: false, status: 'command_failed', exitCode: code, stderr: stripAnsi(stderr), stdout: stripAnsi(stdout) });
      const stats = { available: true, ok: true, status: 'ok', source: 'codearts stats', days: Number(days), ...parseStatsOutput(stdout) };
      writeOfficialStatsCache(stats);
      resolve(markCacheMeta(stats, { savedAt: Date.now() }, 'live'));
    });
  });
}
function fetchOfficialStatsCached(options = {}) {
  const settings = loadSettings();
  const ttlMs = Number(options.ttlMs || settings.officialStatsTtlMs || 180000);
  const available = Boolean(process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK);
  if (!available) return unavailable('missing_CODEARTS_CLI_AK_SK');
  const cache = readOfficialStatsCache();
  const useCache = cache && cache.stats && cache.stats.days === Number(options.days || 7) && Date.now() - (cache.savedAt || 0) <= ttlMs;
  if (!options.force && useCache) return markCacheMeta(cache.stats, cache, 'cache');
  const fresh = fetchOfficialStats(options);
  if (fresh.ok) {
    writeOfficialStatsCache(fresh);
    return markCacheMeta(fresh, { savedAt: Date.now() }, 'live');
  }
  if (cache && cache.stats && options.allowStale !== false) {
    return {
      ...markCacheMeta(cache.stats, cache, 'stale-cache'),
      staleReason: fresh.status,
      lastError: { status: fresh.status, exitCode: fresh.exitCode, error: fresh.error, stderr: fresh.stderr },
    };
  }
  return fresh;
}
function officialStatsCacheStatus() {
  const cache = readOfficialStatsCache();
  const p = officialStatsCachePath();
  if (!cache) return { path: p, exists: false };
  return { path: p, exists: true, savedAt: cache.savedAt ? new Date(cache.savedAt).toISOString() : null, ageMs: Date.now() - (cache.savedAt || 0), ok: Boolean(cache.stats && cache.stats.ok), days: cache.stats && cache.stats.days, sessions: cache.stats && cache.stats.sessions, messages: cache.stats && cache.stats.messages };
}
module.exports = { fetchOfficialStats, fetchOfficialStatsAsync, fetchOfficialStatsCached, officialStatsCacheStatus, parseStatsOutput, stripAnsi };
