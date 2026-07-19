'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { safeJsonStringify, sanitizeForDisk, sanitizeTextForDisk } = require('./logger');

function safeString(value, fallback = '', limit = 4096) {
  if (value == null) return fallback;
  try { return sanitizeTextForDisk(String(value), limit) || fallback; }
  catch { return fallback; }
}

function safeProperty(value, key) {
  try { return value?.[key]; }
  catch { return undefined; }
}

function safeDiskValue(value, fallback = null) {
  try { return sanitizeForDisk(value); }
  catch { return fallback; }
}

function normalizeError(error, seen = new WeakSet(), depth = 0) {
  if (!error || typeof error !== 'object') {
    return { name: 'Error', message: safeString(error, 'Unknown error'), stack: '' };
  }
  if (seen.has(error)) return { name: 'Error', message: '[circular error]', stack: '' };
  seen.add(error);

  const constructorName = safeProperty(safeProperty(error, 'constructor'), 'name');
  const explicitName = safeProperty(error, 'name') || safeProperty(error, 'type');
  const name = safeString(explicitName || (constructorName === 'Object' ? '' : constructorName), 'Error', 120);
  const rawMessage = safeProperty(error, 'message') ?? safeProperty(error, 'reason') ?? safeProperty(error, 'error');
  const normalized = {
    name,
    message: safeString(rawMessage, 'Unknown error', 4096),
    stack: safeString(safeProperty(error, 'stack'), '', 12000),
  };
  const code = safeProperty(error, 'code');
  if (code != null && code !== '') normalized.code = safeString(code, '', 160);
  const errno = safeProperty(error, 'errno');
  if (errno != null && errno !== '') normalized.errno = safeString(errno, '', 160);
  const syscall = safeProperty(error, 'syscall');
  if (syscall != null && syscall !== '') normalized.syscall = safeString(syscall, '', 120);
  const cause = safeProperty(error, 'cause');
  if (cause != null && cause !== error && depth < 2) normalized.cause = normalizeError(cause, seen, depth + 1);
  seen.delete(error);
  return normalized;
}

function readJson(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return sanitizeForDisk(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function writeJson(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeJsonStringify(payload, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function createCrashReporter({
  app,
  appendLog = () => {},
  now = () => Date.now(),
  processRef = process,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let installed = false;
  let startupState = null;
  let heartbeatTimer = null;

  function safeUserDataPath() {
    try { return app?.getPath?.('userData') || os.tmpdir(); }
    catch { return os.tmpdir(); }
  }

  function appVersion() {
    try { return app?.getVersion?.() || ''; }
    catch { return ''; }
  }

  function paths() {
    const dir = safeUserDataPath();
    return {
      dir,
      marker: path.join(dir, 'codearts-bar-runtime.json'),
      processCrash: path.join(dir, 'codearts-bar-last-crash.json'),
      rendererError: path.join(dir, 'codearts-bar-renderer-error.json'),
    };
  }

  function runtimePayload(extra = {}) {
    const time = new Date(now()).toISOString();
    return sanitizeForDisk({
      ...extra,
      app: 'CodeArts Bar',
      version: appVersion(),
      pid: processRef?.pid || null,
      startedAt: extra.startedAt || time,
      updatedAt: extra.updatedAt || time,
      cleanExit: extra.cleanExit === true,
    });
  }

  function writeRuntimeMarker(extra = {}) {
    const p = paths();
    const prev = readJson(p.marker) || {};
    const payload = runtimePayload({
      ...prev,
      ...extra,
      cleanExit: extra.cleanExit === true ? true : false,
      updatedAt: new Date(now()).toISOString(),
    });
    writeJson(p.marker, payload);
    return payload;
  }

  function issueForUncleanExit(marker) {
    if (!marker || marker.cleanExit !== false) return null;
    const when = marker.updatedAt || marker.startedAt || '';
    return {
      tone: 'warn',
      code: 'last_crash_detected',
      title: '上次异常退出',
      detail: when
        ? `上次运行没有正常退出，最后心跳时间：${when}。如果刚刚发生闪退，请复制诊断信息给开发者。`
        : '上次运行没有正常退出。如果刚刚发生闪退，请复制诊断信息给开发者。',
      time: when || null,
    };
  }

  function issueForProcessCrash(crash) {
    if (!crash || !crash.time || crash.resolvedAt) return null;
    const message = crash.error?.message || crash.message || crash.type || 'Unknown error';
    return {
      tone: 'bad',
      code: 'last_process_crash',
      title: '主进程异常已记录',
      detail: `${crash.type || 'process'}：${message}`,
      time: crash.time,
    };
  }

  function issueForRendererError(error) {
    if (!error || !error.time || error.resolvedAt) return null;
    const message = error.error?.message || error.message || error.type || 'Unknown error';
    return {
      tone: 'warn',
      code: 'last_renderer_error',
      title: '界面异常已记录',
      detail: `${error.type || 'renderer'}：${message}`,
      time: error.time,
    };
  }

  function buildState({ includeStartup = true } = {}) {
    const p = paths();
    const marker = readJson(p.marker);
    const processCrash = readJson(p.processCrash);
    const rendererError = readJson(p.rendererError);
    const issues = [];
    const unclean = includeStartup ? issueForUncleanExit(marker) : null;
    const crashIssue = issueForProcessCrash(processCrash);
    const rendererIssue = issueForRendererError(rendererError);
    if (unclean) issues.push(unclean);
    if (crashIssue) issues.push(crashIssue);
    if (rendererIssue) issues.push(rendererIssue);
    return {
      ok: issues.length === 0,
      issues,
      marker,
      processCrash,
      rendererError,
      paths: p,
    };
  }

  function getCrashState() {
    const current = buildState({ includeStartup: !installed });
    if (!startupState || !startupState.issues?.length) return current;
    const seen = new Set((current.issues || []).map((issue) => issue.code));
    const merged = [...(current.issues || [])];
    for (const issue of startupState.issues || []) {
      if (!seen.has(issue.code)) merged.unshift(issue);
    }
    return { ...current, ok: merged.length === 0, issues: merged, startup: startupState };
  }

  function clearRendererError() {
    try { fs.rmSync(paths().rendererError, { force: true }); } catch {}
    if (startupState?.issues) {
      startupState = {
        ...startupState,
        issues: startupState.issues.filter((issue) => issue?.code !== 'last_renderer_error'),
        rendererError: null,
      };
      startupState.ok = startupState.issues.length === 0;
    }
    return true;
  }

  function markStable() {
    const resolvedAt = new Date(now()).toISOString();
    const p = paths();
    for (const file of [p.processCrash, p.rendererError]) {
      const previous = readJson(file);
      if (previous && !previous.resolvedAt) writeJson(file, { ...previous, resolvedAt, resolution: 'stable-run' });
    }
    writeRuntimeMarker({ event: 'stable', cleanExit: false, stableAt: resolvedAt });
    if (startupState?.issues) {
      startupState = {
        ...startupState,
        issues: startupState.issues.filter((issue) => !['last_crash_detected', 'last_process_crash', 'last_renderer_error'].includes(issue?.code)),
        processCrash: readJson(p.processCrash),
        rendererError: readJson(p.rendererError),
      };
      startupState.ok = startupState.issues.length === 0;
    }
    return getCrashState();
  }

  function markCleanExit() {
    if (heartbeatTimer) {
      try { clearIntervalFn(heartbeatTimer); } catch {}
      heartbeatTimer = null;
    }
    return writeRuntimeMarker({ cleanExit: true, exitedAt: new Date(now()).toISOString(), event: 'clean-exit' });
  }

  function recordCrash(type, error, detail = null) {
    const err = normalizeError(error);
    const payload = sanitizeForDisk({
      app: 'CodeArts Bar',
      version: appVersion(),
      pid: processRef?.pid || null,
      type: safeString(type, 'process'),
      time: new Date(now()).toISOString(),
      error: err,
      detail: safeDiskValue(detail, '[unserializable detail]'),
    });
    writeJson(paths().processCrash, payload);
    try { appendLog('fatal', `crash:${payload.type}`, err.message, payload); } catch {}
    return payload;
  }

  function recordRendererError(type, error, detail = null) {
    const err = normalizeError(error);
    const payload = sanitizeForDisk({
      app: 'CodeArts Bar',
      version: appVersion(),
      pid: processRef?.pid || null,
      type: safeString(type, 'renderer'),
      time: new Date(now()).toISOString(),
      error: err,
      detail: safeDiskValue(detail, '[unserializable detail]'),
    });
    writeJson(paths().rendererError, payload);
    try { appendLog('error', `renderer:${payload.type}`, err.message, payload); } catch {}
    return payload;
  }

  function install() {
    if (installed) return getCrashState();
    installed = true;
    startupState = buildState({ includeStartup: true });
    writeRuntimeMarker({ event: 'start', cleanExit: false, startedAt: new Date(now()).toISOString() });
    try {
      heartbeatTimer = setIntervalFn(() => writeRuntimeMarker({ event: 'heartbeat' }), 15000);
      heartbeatTimer?.unref?.();
    } catch {}
    try { app?.on?.('before-quit', () => markCleanExit()); } catch {}
    try {
      processRef?.on?.('uncaughtException', (error) => recordCrash('uncaughtException', error));
      processRef?.on?.('unhandledRejection', (reason) => recordCrash('unhandledRejection', reason));
    } catch {}
    return getCrashState();
  }

  return {
    paths,
    install,
    markCleanExit,
    recordCrash,
    recordRendererError,
    clearRendererError,
    markStable,
    getCrashState,
  };
}

module.exports = { createCrashReporter, normalizeError };
