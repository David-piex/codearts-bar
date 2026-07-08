'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fetchOfficialStatsCached } = require('./officialStats');
const { loadSettings } = require('./settings');

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
function fp(v) { if (!v) return null; const s = String(v); return `${s.slice(0, 4)}…${s.slice(-4)}`; }
function ps(script, timeout = 8000) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout, windowsHide: true });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}
function scanLevelDbIndicators(dir) {
  const out = { exists: exists(dir), files: 0, tokenLikeFiles: 0, authLikeFiles: 0 };
  if (!out.exists) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(ldb|log)$/i.test(f)) continue;
    out.files += 1;
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.size > 2 * 1024 * 1024) continue;
    const txt = fs.readFileSync(p).toString('utf8');
    if (/access[_-]?token|refresh[_-]?token|authorization|bearer/i.test(txt)) out.tokenLikeFiles += 1;
    if (/huaweicloud|codearts|domainId|userInfo|login/i.test(txt)) out.authLikeFiles += 1;
  }
  return out;
}
function sqliteAccountStatus() {
  try {
    const dbPath = loadSettings().dbPath;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
      const result = { dbPath, tables: {}, hasAnyAccount: false };
      for (const t of ['account', 'account_state', 'control_account']) {
        if (!tables.includes(t)) continue;
        const count = db.prepare(`select count(*) as count from ${t}`).get().count;
        result.tables[t] = { count };
        if (count > 0) result.hasAnyAccount = true;
        if (t === 'control_account' && count > 0) {
          result.tables[t].active = db.prepare('select count(*) as count from control_account where active=1').get().count;
        }
      }
      return result;
    } finally { db.close(); }
  } catch (error) {
    return { error: error.message, hasAnyAccount: false, tables: {} };
  }
}
function getAuthStatus(options = {}) {
  const userInfoPath = path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'storage', 'userInfo.json');
  const userInfo = readJson(userInfoPath);
  const cliEnv = { hasAk: Boolean(process.env.CODEARTS_CLI_AK), hasSk: Boolean(process.env.CODEARTS_CLI_SK), ak: fp(process.env.CODEARTS_CLI_AK), sk: process.env.CODEARTS_CLI_SK ? '***' : null };
  const official = options.officialStats || fetchOfficialStatsCached({ timeoutMs: 20000 });
  const procJson = ps("Get-Process | Where-Object {$_.ProcessName -match 'codearts-agent|huawei-turbocontext'} | Select-Object ProcessName,Id | ConvertTo-Json -Compress");
  const processes = procJson ? (() => { try { const v = JSON.parse(procJson); return Array.isArray(v) ? v : [v]; } catch { return []; } })() : [];
  const levelDb = scanLevelDbIndicators(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'codearts-agent', 'Local Storage', 'leveldb'));
  const accountDb = sqliteAccountStatus();
  return {
    generatedAt: new Date().toISOString(),
    cli: { env: cliEnv, officialStats: { available: official.available, ok: official.ok, status: official.status, sessions: official.sessions, messages: official.messages, input: official.input, output: official.output, totalCost: official.totalCost, freshness: official.freshness || null, staleReason: official.staleReason || null } },
    desktop: { userInfo: userInfo ? { exists: true, id: fp(userInfo.id), domainId: fp(userInfo.domainId) } : { exists: false }, localStorage: levelDb, processes },
    database: accountDb,
    summary: {
      cliAuthenticated: Boolean(cliEnv.hasAk && cliEnv.hasSk && official.ok),
      desktopLikelyLoggedIn: Boolean(userInfo && userInfo.id && userInfo.domainId),
      dbHasOAuthAccounts: Boolean(accountDb.hasAnyAccount),
      agentRunning: processes.length > 0,
    },
  };
}
function authStatusToText(a) {
  const lines = [];
  lines.push('CodeArts Auth Status');
  lines.push(`CLI AK/SK: ${a.cli.env.hasAk && a.cli.env.hasSk ? 'present' : 'missing'}${a.cli.env.ak ? ` (${a.cli.env.ak})` : ''}`);
  lines.push(`Official stats: ${a.cli.officialStats.ok ? 'OK' : a.cli.officialStats.status}`);
  if (a.cli.officialStats.ok) lines.push(`Official usage: input=${a.cli.officialStats.input || 0}, output=${a.cli.officialStats.output || 0}, cost=$${a.cli.officialStats.totalCost || 0}`);
  lines.push(`Desktop userInfo: ${a.desktop.userInfo.exists ? 'present' : 'missing'}`);
  lines.push(`Agent running: ${a.summary.agentRunning ? 'yes' : 'no'} (${a.desktop.processes.length} processes)`);
  lines.push(`DB OAuth accounts: ${a.summary.dbHasOAuthAccounts ? 'present' : 'none'}`);
  lines.push(`LocalStorage auth indicators: tokenLikeFiles=${a.desktop.localStorage.tokenLikeFiles}, authLikeFiles=${a.desktop.localStorage.authLikeFiles}`);
  return lines.join('\n');
}
module.exports = { getAuthStatus, authStatusToText };
