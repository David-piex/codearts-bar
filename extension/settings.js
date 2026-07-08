'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function configDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'CodeArtsBar');
}
function settingsPath() { return path.join(configDir(), 'settings.json'); }
function cachePath() { return path.join(configDir(), 'snapshot-cache.json'); }
function officialStatsCachePath() { return path.join(configDir(), 'official-stats-cache.json'); }

const defaults = {
  dbPath: path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'opencode.db'),
  dailyLimit: 200000,
  windowHours: 24,
  refreshMs: 5000,
  officialStatsTtlMs: 180000,
  ttftWarnMs: 5000,
  latencyWarnMs: 60000,
  balanceDangerAgeMs: 1800000,
  balanceWarningAgeMs: 86400000,
  notifyHealth: true,
  showPerformance: true,
  showTools: true,
  notifyDanger: true,
};

function ensureDir() { fs.mkdirSync(configDir(), { recursive: true }); }
function loadSettings() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(settingsPath(), 'utf8').replace(/^\uFEFF/, '')); } catch {}
  const merged = { ...defaults, ...file };
  if (process.env.CODEARTS_BAR_DB) merged.dbPath = process.env.CODEARTS_BAR_DB;
  if (process.env.CODEARTS_BAR_DAILY_LIMIT) merged.dailyLimit = Number(process.env.CODEARTS_BAR_DAILY_LIMIT);
  if (process.env.CODEARTS_BAR_WINDOW_HOURS) merged.windowHours = Number(process.env.CODEARTS_BAR_WINDOW_HOURS);
  if (process.env.CODEARTS_BAR_REFRESH_MS) merged.refreshMs = Number(process.env.CODEARTS_BAR_REFRESH_MS);
  if (process.env.CODEARTS_BAR_OFFICIAL_STATS_TTL_MS) merged.officialStatsTtlMs = Number(process.env.CODEARTS_BAR_OFFICIAL_STATS_TTL_MS);
  if (process.env.CODEARTS_BAR_TTFT_WARN_MS) merged.ttftWarnMs = Number(process.env.CODEARTS_BAR_TTFT_WARN_MS);
  if (process.env.CODEARTS_BAR_LATENCY_WARN_MS) merged.latencyWarnMs = Number(process.env.CODEARTS_BAR_LATENCY_WARN_MS);
  if (process.env.CODEARTS_BAR_BALANCE_DANGER_AGE_MS) merged.balanceDangerAgeMs = Number(process.env.CODEARTS_BAR_BALANCE_DANGER_AGE_MS);
  if (process.env.CODEARTS_BAR_BALANCE_WARNING_AGE_MS) merged.balanceWarningAgeMs = Number(process.env.CODEARTS_BAR_BALANCE_WARNING_AGE_MS);
  merged.dailyLimit = Number.isFinite(Number(merged.dailyLimit)) ? Number(merged.dailyLimit) : defaults.dailyLimit;
  merged.windowHours = Number.isFinite(Number(merged.windowHours)) ? Number(merged.windowHours) : defaults.windowHours;
  merged.refreshMs = Math.max(1000, Math.min(15000, Number.isFinite(Number(merged.refreshMs)) ? Number(merged.refreshMs) : defaults.refreshMs));
  merged.officialStatsTtlMs = Math.max(30000, Number.isFinite(Number(merged.officialStatsTtlMs)) ? Number(merged.officialStatsTtlMs) : defaults.officialStatsTtlMs);
  merged.ttftWarnMs = Math.max(1000, Number.isFinite(Number(merged.ttftWarnMs)) ? Number(merged.ttftWarnMs) : defaults.ttftWarnMs);
  merged.latencyWarnMs = Math.max(5000, Number.isFinite(Number(merged.latencyWarnMs)) ? Number(merged.latencyWarnMs) : defaults.latencyWarnMs);
  merged.balanceDangerAgeMs = Math.max(60000, Number.isFinite(Number(merged.balanceDangerAgeMs)) ? Number(merged.balanceDangerAgeMs) : defaults.balanceDangerAgeMs);
  merged.balanceWarningAgeMs = Math.max(merged.balanceDangerAgeMs, Number.isFinite(Number(merged.balanceWarningAgeMs)) ? Number(merged.balanceWarningAgeMs) : defaults.balanceWarningAgeMs);
  return merged;
}
function saveSettings(next) {
  ensureDir();
  const clean = { ...loadSettings(), ...next };
  clean.refreshMs = Math.max(1000, Math.min(15000, Number.isFinite(Number(clean.refreshMs)) ? Number(clean.refreshMs) : defaults.refreshMs));
  fs.writeFileSync(settingsPath(), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
function writeCache(snapshot) {
  try {
    ensureDir();
    fs.writeFileSync(cachePath(), JSON.stringify({ savedAt: Date.now(), snapshot }, null, 2), 'utf8');
  } catch {}
}
function readCache() {
  const data = JSON.parse(fs.readFileSync(cachePath(), 'utf8').replace(/^\uFEFF/, ''));
  return data;
}

module.exports = { defaults, configDir, settingsPath, cachePath, officialStatsCachePath, loadSettings, saveSettings, writeCache, readCache };
