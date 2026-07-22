'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SOURCE_DEFS } = require('./sources');
const { configDir } = require('../../settings');
const { findCodeArtsAgentExecutable } = require('../../codearts-installation');

const LOG_CACHE_VERSION = 2;
let diskLogCacheLoaded = false;
let diskLogCacheDirty = false;
let diskLogCache = { version: LOG_CACHE_VERSION, entries: {} };

function logParseCachePath() { return path.join(configDir(), 'log-parse-cache.json'); }
function loadDiskLogCache() {
  if (diskLogCacheLoaded) return;
  diskLogCacheLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(logParseCachePath(), 'utf8').replace(/^\uFEFF/, ''));
    if (raw && raw.version === LOG_CACHE_VERSION && raw.entries && typeof raw.entries === 'object') diskLogCache = raw;
  } catch {}
}
function persistDiskLogCache() {
  if (!diskLogCacheDirty) return;
  diskLogCacheDirty = false;
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    const entries = Object.entries(diskLogCache.entries || {});
    if (entries.length > 700) {
      entries.sort((a, b) => Number(a[1]?.usedAt || 0) - Number(b[1]?.usedAt || 0));
      diskLogCache.entries = Object.fromEntries(entries.slice(-520));
    }
    fs.writeFileSync(logParseCachePath(), JSON.stringify(diskLogCache), 'utf8');
  } catch {}
}

function parseLogTimestamp(line) {
  const m = line.match(/INFO\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}
function extractJsonArray(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
function decodeQueuePayload(text) {
  const candidates = [];
  let pos = 0;
  while (pos >= 0 && pos < text.length) {
    const start = text.indexOf('[{', pos);
    if (start < 0) break;
    const raw = extractJsonArray(text, start);
    if (raw) candidates.push(raw);
    pos = start + 2;
  }
  for (const raw of candidates.reverse()) {
  try {
    const arr = JSON.parse(raw);
    const head = arr && arr[0];
    if (!head || typeof head !== 'object') return null;
      if (!('status' in head) && !('queue_length' in head) && !('queue_position' in head)) continue;
    const val = (key) => {
      const pointer = head[key];
      if (typeof pointer === 'string' && /^\d+$/.test(pointer)) return arr[Number(pointer)];
      return pointer;
    };
    const taskId = String(val('task_id') || '');
    const sessionId = taskId.match(/(ses_[A-Za-z0-9]+)/)?.[1] || null;
    return {
      taskId,
      sessionId,
      model: val('model') || null,
      status: val('status') || null,
      queueLength: Number(head.queue_length || 0),
      queuePosition: Number(head.queue_position || 0),
      message: val('message') || '',
    };
  } catch {
      continue;
    }
  }
  return null;
}
const parsedLogCache = new Map();
const recentFilesCache = new Map();
function logCacheKey(type, fp) { return `${type}:${fp}`; }
function pruneParsedLogCache() {
  if (parsedLogCache.size <= 700) return;
  const entries = [...parsedLogCache.entries()].sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
  for (const [key] of entries.slice(0, Math.max(1, parsedLogCache.size - 520))) parsedLogCache.delete(key);
}
function recentLogFiles(root, maxFiles = 250, maxSize = 12 * 1024 * 1024) {
  if (!fs.existsSync(root)) return [];
  let rootStat = null;
  try { rootStat = fs.statSync(root); } catch { return []; }
  const key = `${root}:${maxFiles}`;
  const cached = recentFilesCache.get(key);
  if (cached && cached.mtimeMs === rootStat.mtimeMs && cached.size === rootStat.size) {
    return cached.files.filter(({ st }) => st.size <= maxSize);
  }
  const files = fs.readdirSync(root)
    .filter((f) => f.endsWith('.log'))
    .sort()
    .slice(-maxFiles)
    .map((f) => {
      const fp = path.join(root, f);
      const st = fs.statSync(fp);
      return { f, fp, st };
    });
  recentFilesCache.set(key, { mtimeMs: rootStat.mtimeMs, size: rootStat.size, files });
  if (recentFilesCache.size > 12) recentFilesCache.delete(recentFilesCache.keys().next().value);
  return files.filter(({ st }) => st.size <= maxSize);
}
function parseCachedLogFile(type, root, file, parser) {
  const { f, fp, st } = file;
  const key = logCacheKey(type, fp);
  const hit = parsedLogCache.get(key);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
    hit.usedAt = Date.now();
    return hit.items;
  }
  loadDiskLogCache();
  const diskHit = diskLogCache.entries?.[key];
  if (diskHit && diskHit.size === st.size && diskHit.mtimeMs === st.mtimeMs && Array.isArray(diskHit.items)) {
    parsedLogCache.set(key, { size: st.size, mtimeMs: st.mtimeMs, usedAt: Date.now(), items: diskHit.items });
    return diskHit.items;
  }
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
  const items = parser(lines, f, root);
  const entry = { size: st.size, mtimeMs: st.mtimeMs, usedAt: Date.now(), items };
  parsedLogCache.set(key, entry);
  diskLogCache.entries[key] = entry;
  diskLogCacheDirty = true;
  pruneParsedLogCache();
  return items;
}
function parseQueueLogLines(lines, f, root) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/inferhub-queue/.test(line) || !/Polling params/.test(line)) continue;
    const at = parseLogTimestamp(line);
    const payloadText = [line, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join('\n');
    const decoded = decodeQueuePayload(payloadText);
    if (!decoded || !decoded.sessionId || !decoded.status) continue;
    out.push({ ...decoded, at, file: f, line: i + 1, logRoot: root });
  }
  return out;
}
function parseTtftLogLines(lines, f, root) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/Infer stream first token generated in/.test(line)) continue;
    const session = line.match(/\[(ses_[^\]]+)\]/)?.[1] || null;
    const req = line.match(/\]\s+\[([^\]]+)\]\s+Infer/)?.[1] || null;
    const ms = Number(line.match(/generated in\s+(\d+)ms/)?.[1]);
    const at = Number(line.match(/\sat\s+(\d{10,})/)?.[1]);
    if (!session || !Number.isFinite(ms)) continue;
    out.push({ sessionId: session, requestId: req, ttftMs: ms, firstTokenAt: at || parseLogTimestamp(line), file: f, line: i + 1, logRoot: root });
  }
  return out;
}
function queueEpisodesFromPollEvents(pollEvents = []) {
  pollEvents.sort((a, b) => (a.at || 0) - (b.at || 0));
  const episodes = [];
  const active = new Map();
  for (const event of pollEvents) {
    const key = event.taskId || `${event.sessionId}:${event.model || ''}`;
    if (event.status === 'waiting') {
      const current = active.get(key) || { taskId: event.taskId, sessionId: event.sessionId, model: event.model, start: event.at, end: null, queueLengthMax: 0, queuePositionStart: event.queuePosition || 0, queuePositionLast: event.queuePosition || 0, polls: 0, message: event.message, sourceFile: event.file };
      current.start = Math.min(current.start || event.at, event.at || current.start);
      current.queueLengthMax = Math.max(current.queueLengthMax || 0, event.queueLength || 0);
      if (!current.queuePositionStart) current.queuePositionStart = event.queuePosition || 0;
      current.queuePositionLast = event.queuePosition || current.queuePositionLast || 0;
      current.polls += 1;
      current.message = event.message || current.message;
      active.set(key, current);
    } else if (event.status === 'working' || event.status === 'delete working queue success') {
      const current = active.get(key);
      if (current && event.at && current.start && event.at >= current.start) {
        current.end = event.at;
        current.durationMs = event.at - current.start;
        current.status = event.status;
        episodes.push(current);
        active.delete(key);
      }
    }
  }
  return episodes.filter((x) => Number.isFinite(x.durationMs) && x.durationMs >= 0);
}
function scanQueueLogs(logRoot) {
  const roots = logRoot ? [logRoot] : SOURCE_DEFS.map((s) => s.logRoot);
  const pollEvents = [];
  for (const root of roots) {
    try {
      for (const file of recentLogFiles(root, 250, 15 * 1024 * 1024)) {
        pollEvents.push(...parseCachedLogFile('queue', root, file, parseQueueLogLines));
      }
    } catch {}
  }
  persistDiskLogCache();
  return queueEpisodesFromPollEvents(pollEvents);
}
function scanTtftLogs(logRoot) {
  const roots = logRoot ? [logRoot] : SOURCE_DEFS.map((s) => s.logRoot);
  const out = [];
  for (const root of roots) {
    try {
      for (const file of recentLogFiles(root, 250, 12 * 1024 * 1024)) {
        out.push(...parseCachedLogFile('ttft', root, file, parseTtftLogLines));
      }
    } catch {}
  }
  persistDiskLogCache();
  return out;
}
function scanUsageLogs(logRoot) {
  const roots = logRoot ? [logRoot] : SOURCE_DEFS.map((s) => s.logRoot);
  const ttftEvents = [];
  const pollEvents = [];
  for (const root of roots) {
    try {
      for (const file of recentLogFiles(root, 250, 15 * 1024 * 1024)) {
        ttftEvents.push(...parseCachedLogFile('ttft', root, file, parseTtftLogLines));
        pollEvents.push(...parseCachedLogFile('queue', root, file, parseQueueLogLines));
      }
    } catch {}
  }
  persistDiskLogCache();
  return { ttftEvents, queueEvents: queueEpisodesFromPollEvents(pollEvents) };
}
function readCodeArtsConfig(configPath = path.join(os.homedir(), '.codeartsdoer', 'codearts_cli.json')) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    const providers = data.provider || {};
    return {
      path: configPath,
      exists: true,
      enabledProviders: data.enabled_providers || [],
      plugins: data.plugin || [],
      providers: Object.entries(providers).map(([id, p]) => ({ id, name: p.name || id, baseURL: p.options?.baseURL || null, modelCount: p.models ? Object.keys(p.models).length : 0, hasApiKey: Boolean(p.options?.apiKey) })),
      officialQuota: {
        available: Boolean(process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK),
        source: 'codearts stats',
        status: process.env.CODEARTS_CLI_AK && process.env.CODEARTS_CLI_SK ? 'env_configured' : 'missing_CODEARTS_CLI_AK_SK',
      },
    };
  } catch (error) {
    return { path: configPath, exists: false, error: error.message, enabledProviders: [], plugins: [], providers: [], officialQuota: { available: false, source: 'codearts stats', status: 'config_unreadable' } };
  }
}
function detectProcesses() {
  return {
    expectedExe: findCodeArtsAgentExecutable(),
    cli: path.join(os.homedir(), '.codeartsdoer', 'installers', 'codearts.cmd'),
  };
}

module.exports = { parseLogTimestamp, extractJsonArray, decodeQueuePayload, scanQueueLogs, scanTtftLogs, scanUsageLogs, readCodeArtsConfig, detectProcesses };
