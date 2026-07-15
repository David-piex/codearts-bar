'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const { writeJsonAtomic } = require('./core/atomic-file');

function configDir() {
  if (process.env.CODEARTS_BAR_CONFIG_DIR) return path.resolve(process.env.CODEARTS_BAR_CONFIG_DIR);
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'CodeArtsBar');
}
function settingsPath() { return path.join(configDir(), 'settings.json'); }
function cachePath() { return path.join(configDir(), 'snapshot-cache.json'); }
function officialStatsCachePath() { return path.join(configDir(), 'official-stats-cache.json'); }
function rollupCacheDir() { return path.join(configDir(), 'rollup-cache'); }
function rollupCachePath(dbPath, kind = 'usage-rollup') {
  const crypto = require('node:crypto');
  const safeKind = String(kind || 'usage-rollup').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 64) || 'usage-rollup';
  const hash = crypto.createHash('sha256').update(path.resolve(String(dbPath || ''))).digest('hex').slice(0, 24);
  return path.join(rollupCacheDir(), `${hash}.${safeKind}.json`);
}

const defaults = {
  dbPath: path.join(os.homedir(), '.codeartsdoer', 'codearts-data', 'opencode.db'),
  dailyLimit: 200000,
  windowHours: 24,
  refreshMs: 5000,
  dbWatchVisiblePollMs: 4000,
  dbWatchHiddenPollMs: 15000,
  officialStatsTtlMs: 180000,
  ttftWarnMs: 5000,
  latencyWarnMs: 60000,
  balanceDangerAgeMs: 1800000,
  balanceWarningAgeMs: 86400000,
  notifyHealth: true,
  showPerformance: true,
  showTools: true,
  notifyDanger: true,
  rollupMaintenance: { lastRollupBuildMs: 0, bySource: {} },
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
function normalizeSettings(file = {}, env = process.env) {
  const merged = { ...defaults, ...file };
  if (env.CODEARTS_BAR_DB) merged.dbPath = env.CODEARTS_BAR_DB;
  if (env.CODEARTS_BAR_DAILY_LIMIT) merged.dailyLimit = Number(env.CODEARTS_BAR_DAILY_LIMIT);
  if (env.CODEARTS_BAR_WINDOW_HOURS) merged.windowHours = Number(env.CODEARTS_BAR_WINDOW_HOURS);
  if (env.CODEARTS_BAR_REFRESH_MS) merged.refreshMs = Number(env.CODEARTS_BAR_REFRESH_MS);
  if (env.CODEARTS_BAR_DB_WATCH_VISIBLE_POLL_MS) merged.dbWatchVisiblePollMs = Number(env.CODEARTS_BAR_DB_WATCH_VISIBLE_POLL_MS);
  if (env.CODEARTS_BAR_DB_WATCH_HIDDEN_POLL_MS) merged.dbWatchHiddenPollMs = Number(env.CODEARTS_BAR_DB_WATCH_HIDDEN_POLL_MS);
  if (env.CODEARTS_BAR_OFFICIAL_STATS_TTL_MS) merged.officialStatsTtlMs = Number(env.CODEARTS_BAR_OFFICIAL_STATS_TTL_MS);
  if (env.CODEARTS_BAR_TTFT_WARN_MS) merged.ttftWarnMs = Number(env.CODEARTS_BAR_TTFT_WARN_MS);
  if (env.CODEARTS_BAR_LATENCY_WARN_MS) merged.latencyWarnMs = Number(env.CODEARTS_BAR_LATENCY_WARN_MS);
  if (env.CODEARTS_BAR_BALANCE_DANGER_AGE_MS) merged.balanceDangerAgeMs = Number(env.CODEARTS_BAR_BALANCE_DANGER_AGE_MS);
  if (env.CODEARTS_BAR_BALANCE_WARNING_AGE_MS) merged.balanceWarningAgeMs = Number(env.CODEARTS_BAR_BALANCE_WARNING_AGE_MS);
  merged.dailyLimit = Number.isFinite(Number(merged.dailyLimit)) ? Number(merged.dailyLimit) : defaults.dailyLimit;
  merged.windowHours = Number.isFinite(Number(merged.windowHours)) ? Number(merged.windowHours) : defaults.windowHours;
  merged.refreshMs = clamp(merged.refreshMs, 1000, 15000, defaults.refreshMs);
  merged.dbWatchVisiblePollMs = clamp(merged.dbWatchVisiblePollMs, 1000, 60000, defaults.dbWatchVisiblePollMs);
  merged.dbWatchHiddenPollMs = clamp(merged.dbWatchHiddenPollMs, merged.dbWatchVisiblePollMs, 300000, defaults.dbWatchHiddenPollMs);
  merged.officialStatsTtlMs = Math.max(30000, Number.isFinite(Number(merged.officialStatsTtlMs)) ? Number(merged.officialStatsTtlMs) : defaults.officialStatsTtlMs);
  merged.ttftWarnMs = Math.max(1000, Number.isFinite(Number(merged.ttftWarnMs)) ? Number(merged.ttftWarnMs) : defaults.ttftWarnMs);
  merged.latencyWarnMs = Math.max(5000, Number.isFinite(Number(merged.latencyWarnMs)) ? Number(merged.latencyWarnMs) : defaults.latencyWarnMs);
  merged.balanceDangerAgeMs = Math.max(60000, Number.isFinite(Number(merged.balanceDangerAgeMs)) ? Number(merged.balanceDangerAgeMs) : defaults.balanceDangerAgeMs);
  merged.balanceWarningAgeMs = Math.max(merged.balanceDangerAgeMs, Number.isFinite(Number(merged.balanceWarningAgeMs)) ? Number(merged.balanceWarningAgeMs) : defaults.balanceWarningAgeMs);
  const maintenance = merged.rollupMaintenance && typeof merged.rollupMaintenance === 'object' ? merged.rollupMaintenance : {};
  merged.rollupMaintenance = {
    lastRollupBuildMs: Math.max(0, Number(maintenance.lastRollupBuildMs) || 0),
    bySource: maintenance.bySource && typeof maintenance.bySource === 'object' ? { ...maintenance.bySource } : {},
  };
  return merged;
}
function readSettingsFile(file = settingsPath()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return {}; }
}
function settingsFingerprint(file = settingsPath()) {
  try { const st = fs.statSync(file); return `${st.size}:${Math.round(st.mtimeMs)}`; }
  catch { return 'missing'; }
}
function ensureDir() { fs.mkdirSync(configDir(), { recursive: true }); }
function createSettingsStore({ file = settingsPath(), watch = true, env = process.env } = {}) {
  const events = new EventEmitter();
  let value = null;
  let fingerprint = '';
  let watching = false;
  let reloadTimer = null;
  function reload(reason = 'read') {
    const next = normalizeSettings(readSettingsFile(file), env);
    const changed = JSON.stringify(next) !== JSON.stringify(value);
    value = next;
    fingerprint = settingsFingerprint(file);
    if (changed && reason !== 'read') events.emit('change', { settings: { ...value }, reason });
    return value;
  }
  function get() {
    const nextFingerprint = settingsFingerprint(file);
    if (!value || nextFingerprint !== fingerprint) reload(value ? 'fingerprint' : 'read');
    return { ...value };
  }
  function save(next = {}) {
    value = normalizeSettings({ ...get(), ...next }, env);
    writeJsonAtomic(file, value);
    fingerprint = settingsFingerprint(file);
    events.emit('change', { settings: { ...value }, reason: 'save' });
    return { ...value };
  }
  function start() {
    if (!watch || watching) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    watching = true;
    fs.watchFile(file, { persistent: false, interval: 500 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => reload('watch'), 80);
    });
  }
  function close() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
    if (watching) fs.unwatchFile(file);
    watching = false;
    events.removeAllListeners();
  }
  function onDidChange(listener) { events.on('change', listener); return () => events.off('change', listener); }
  start();
  return { get, save, reload, close, onDidChange, file };
}

let defaultStore = null;
function getDefaultSettingsStore() {
  const file = settingsPath();
  if (!defaultStore || defaultStore.file !== file) {
    defaultStore?.close();
    defaultStore = createSettingsStore({ file });
  }
  return defaultStore;
}
function loadSettings() { return getDefaultSettingsStore().get(); }
function saveSettings(next) { return getDefaultSettingsStore().save(next); }
function watchSettings(listener) { return getDefaultSettingsStore().onDidChange(listener); }
function closeSettingsStore() { defaultStore?.close(); defaultStore = null; }
function writeCache(snapshot) {
  try { ensureDir(); writeJsonAtomic(cachePath(), { savedAt: Date.now(), snapshot }); } catch {}
}
function readCache() { return JSON.parse(fs.readFileSync(cachePath(), 'utf8').replace(/^\uFEFF/, '')); }

module.exports = { defaults, configDir, settingsPath, cachePath, officialStatsCachePath, rollupCacheDir, rollupCachePath, normalizeSettings, createSettingsStore, loadSettings, saveSettings, watchSettings, closeSettingsStore, writeCache, readCache };
