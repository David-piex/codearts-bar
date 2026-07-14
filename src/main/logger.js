'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { redactSensitiveText } = require('../core/sensitive-text');

const DEFAULT_MAX_LOG_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_LENGTH = 8192;
const MAX_COLLECTION_ENTRIES = 50;
const MAX_OBJECT_DEPTH = 6;
const MAX_SERIALIZED_NODES = 200;
const REDACTED = '[redacted]';
const REDACTED_PAYLOAD = '[redacted payload]';
const TRUNCATED = '[truncated]';
const CIRCULAR = '[circular]';

const SECRET_KEY = /(?:^|[_-])(?:auth(?:orization)?|cookie|credential|password|passwd|passphrase|secret|token|private[_-]?key|api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|ak|sk)(?:$|[_-])/i;
const SECRET_KEY_COMPACT = /(?:authorization|authheader|setcookie|apikey|accesskey|secretkey|privatekey|clientsecret|accesstoken|refreshtoken|idtoken|password|passwd|passphrase|secret|token|credential|cookie)/i;
const REQUEST_CONTAINER_KEY = /^(?:payload|request|requestpayload|requestbody)$/i;
const REQUEST_CONTENT_KEY = /^(?:body|headers|messages|prompt|systemprompt|userprompt|content|input|query|sessionquery|variables|params)$/i;
const REQUEST_META_NUMBERS = new Set([
  'limit', 'offset', 'page', 'pagesize', 'start', 'end', 'endexclusive', 'timestamp',
  'since', 'bucketms', 'generation', 'requestgeneration',
]);
const REQUEST_META_BOOLEANS = new Set(['errorsonly', 'error', 'force', 'refresh', 'includehidden']);
const REQUEST_META_STRINGS = new Set(['source', 'model', 'status', 'project', 'reason', 'resource', 'view', 'sort', 'type']);

function stringValue(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); }
  catch { return fallback; }
}

function truncateText(value, limit = MAX_TEXT_LENGTH) {
  const text = stringValue(value);
  const max = Math.max(0, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : MAX_TEXT_LENGTH);
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
}

function sanitizeTextForDisk(value, limit = MAX_TEXT_LENGTH) {
  const normalizedLimit = Math.max(0, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : MAX_TEXT_LENGTH);
  let text = truncateText(value, normalizedLimit + 2048);
  text = text
    .replace(/\b(?:proxy-)?authorization\s*[:=]\s*(?:(?:basic|digest|bearer)\s+)?[^\s,;]+/gi, 'Authorization: [redacted]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|access[_-]?key|secret|token|password|passwd|client[_-]?secret|credential|signature|sig)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi, 'Cookie: [redacted]')
    .replace(/\b((?:request[_ -]?payload|request[_ -]?body|payload)\s*[:=]\s*)(?:\{[^\r\n]*\}|\[[^\r\n]*\]|[^\r\n]+)/gi, '$1[redacted]')
    .replace(/((?:["']?(?:authorization|proxy[_-]?authorization|api[_-]?(?:key|secret)|access[_-]?(?:key|token)|secret[_-]?key|client[_-]?secret|refresh[_-]?token|id[_-]?token|password|passwd|passphrase|token|credential|cookie)["']?\s*[:=]\s*))(?:(?:"(?:\\.|[^"])*")|(?:'(?:\\.|[^'])*')|[^,;}\s\r\n]+)/gi, '$1[redacted]')
    .replace(/((?:["']?(?:system[_-]?prompt|user[_-]?prompt|prompt|messages?|content|input)["']?\s*[:=]\s*))(?:(?:"(?:\\.|[^"])*")|(?:'(?:\\.|[^'])*')|[^,;\r\n]+)/gi, '$1[redacted]');
  text = redactSensitiveText(text)
    .replace(/\b(?:sk|rk|pk)-(?:live-|test-|proj-)?[A-Za-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, REDACTED)
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED)
    .replace(/(^|[\s("'=])(?:file:\/\/\/)?[A-Za-z]:[\\/][^\r\n:"'<>|()]*/gm, '$1[path]')
    .replace(/\\\\[^\\/\s]+[\\/][^\r\n:"'<>|()]*/g, '[path]')
    .replace(/(^|[\s("'=])\/(?!\/)[^:\r\n"'<>|()]*/gm, '$1[path]');
  return truncateText(text, normalizedLimit);
}

function safeProperty(value, key) {
  try { return value?.[key]; }
  catch { return undefined; }
}

function sanitizeRequestMetadata(value) {
  if (!value || typeof value !== 'object') return REDACTED_PAYLOAD;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return REDACTED_PAYLOAD; }
  const out = { _redacted: true };
  for (const [key, descriptor] of Object.entries(descriptors).slice(0, MAX_COLLECTION_ENTRIES)) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const item = descriptor.value;
    if (REQUEST_META_NUMBERS.has(normalized)) {
      const number = Number(item);
      if (Number.isFinite(number)) out[key] = number;
      continue;
    }
    if (REQUEST_META_BOOLEANS.has(normalized)) {
      if (typeof item === 'boolean') out[key] = item;
      continue;
    }
    if (REQUEST_META_STRINGS.has(normalized)) {
      out[key] = sanitizeTextForDisk(item, 120);
      continue;
    }
    if (normalized === 'range' && item && typeof item === 'object') {
      const range = {};
      for (const rangeKey of ['start', 'end', 'endExclusive']) {
        const number = Number(safeProperty(item, rangeKey));
        if (Number.isFinite(number)) range[rangeKey] = number;
      }
      if (Object.keys(range).length) out.range = range;
    }
  }
  return out;
}

function sanitizeForDisk(value, options = {}, state = null) {
  const settings = {
    depth: Number(options.depth || 0),
    maxDepth: Number(options.maxDepth || MAX_OBJECT_DEPTH),
    maxEntries: Number(options.maxEntries || MAX_COLLECTION_ENTRIES),
    maxStringLength: Number(options.maxStringLength || MAX_TEXT_LENGTH),
    maxNodes: Number(options.maxNodes || MAX_SERIALIZED_NODES),
  };
  const context = state && state.seen instanceof WeakSet
    ? state
    : { seen: state instanceof WeakSet ? state : new WeakSet(), remaining: settings.maxNodes };
  const seen = context.seen;

  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : stringValue(value);
  if (typeof value === 'bigint') return stringValue(value);
  if (typeof value === 'string') return sanitizeTextForDisk(value, settings.maxStringLength);
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
  if (settings.depth >= settings.maxDepth) return TRUNCATED;
  if (context.remaining <= 0) return TRUNCATED;
  context.remaining -= 1;

  if (value instanceof Date) {
    try { return value.toISOString(); }
    catch { return '[invalid date]'; }
  }
  if (value instanceof RegExp) return sanitizeTextForDisk(value.toString(), settings.maxStringLength);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const size = Number(value.byteLength ?? value.length ?? 0);
    return `[binary ${Number.isFinite(size) ? size : 0} bytes]`;
  }
  if (value instanceof Map) return `[map ${value.size} entries]`;
  if (value instanceof Set) return `[set ${value.size} entries]`;

  if (seen.has(value)) return CIRCULAR;
  seen.add(value);
  const nestedOptions = { ...settings, depth: settings.depth + 1 };

  if (value instanceof Error) {
    const constructorName = safeProperty(safeProperty(value, 'constructor'), 'name');
    const out = {
      name: sanitizeTextForDisk(safeProperty(value, 'name') || constructorName || 'Error', 120),
      message: sanitizeTextForDisk(safeProperty(value, 'message') || '', Math.min(settings.maxStringLength, 4096)),
      stack: sanitizeTextForDisk(safeProperty(value, 'stack') || '', Math.min(settings.maxStringLength, 12000)),
    };
    const code = safeProperty(value, 'code');
    if (code != null && code !== '') out.code = sanitizeTextForDisk(code, 160);
    const cause = safeProperty(value, 'cause');
    if (cause != null && cause !== value) out.cause = sanitizeForDisk(cause, nestedOptions, context);
    seen.delete(value);
    return out;
  }

  if (Array.isArray(value)) {
    const out = value.slice(0, Math.max(0, settings.maxEntries)).map((item) => sanitizeForDisk(item, nestedOptions, context));
    if (value.length > settings.maxEntries) out.push(`[${value.length - settings.maxEntries} more items]`);
    seen.delete(value);
    return out;
  }

  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch {
    seen.delete(value);
    return '[unserializable object]';
  }
  const out = {};
  const entries = Object.entries(descriptors).slice(0, Math.max(0, settings.maxEntries));
  for (const [rawKey, descriptor] of entries) {
    const key = sanitizeTextForDisk(rawKey, 120) || 'field';
    const normalized = rawKey.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (SECRET_KEY.test(rawKey) || SECRET_KEY_COMPACT.test(normalized)) {
      out[key] = REDACTED;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      out[key] = '[accessor]';
      continue;
    }
    if (REQUEST_CONTAINER_KEY.test(normalized)) {
      out[key] = sanitizeRequestMetadata(descriptor.value);
      continue;
    }
    if (REQUEST_CONTENT_KEY.test(normalized)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = sanitizeForDisk(descriptor.value, nestedOptions, context);
  }
  if (Object.keys(descriptors).length > entries.length) out._truncatedFields = Object.keys(descriptors).length - entries.length;
  seen.delete(value);
  return out;
}

function safeJsonStringify(value, space = 0, options = {}) {
  try {
    const safe = sanitizeForDisk(value, options);
    return JSON.stringify(safe === undefined ? null : safe, null, space);
  } catch {
    return '{"serializationError":"SerializationError"}';
  }
}

function normalizeMaxBytes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(512, Math.trunc(number)) : DEFAULT_MAX_LOG_BYTES;
}

function createLogger({ app, shell, maxBytes = DEFAULT_MAX_LOG_BYTES } = {}) {
  const logLimit = normalizeMaxBytes(maxBytes);
  let writeQueue = Promise.resolve();
  let legacyBoundsChecked = false;

  function safeUserDataPath() {
    try { return app?.getPath?.('userData') || os.tmpdir(); }
    catch { return os.tmpdir(); }
  }

  function logPath() {
    return path.join(safeUserDataPath(), 'codearts-bar.log');
  }

  function rotatedLogPath() {
    return `${logPath()}.1`;
  }

  function serializeEntry(level, scope, message, detail) {
    let safeDetail = null;
    try { safeDetail = detail == null ? null : sanitizeForDisk(detail); }
    catch { safeDetail = '[unserializable detail]'; }
    const entry = {
      time: new Date().toISOString(),
      level: sanitizeTextForDisk(level || 'info', 24) || 'info',
      scope: sanitizeTextForDisk(scope || 'app', 160) || 'app',
      message: sanitizeTextForDisk(message || '', 4096),
      detail: safeDetail,
    };
    let line = safeJsonStringify(entry);
    if (Buffer.byteLength(`${line}\n`, 'utf8') <= logLimit) return line;

    entry.detail = TRUNCATED;
    entry.message = truncateText(entry.message, Math.max(32, Math.min(1024, Math.floor(logLimit / 2))));
    line = safeJsonStringify(entry);
    if (Buffer.byteLength(`${line}\n`, 'utf8') <= logLimit) return line;

    return safeJsonStringify({
      time: entry.time,
      level: entry.level,
      scope: truncateText(entry.scope, 40),
      message: '[log entry exceeded size limit]',
    });
  }

  async function removeFile(file) {
    try { await fs.promises.rm(file, { force: true }); }
    catch {}
  }

  async function rotateForAppend(file, incomingBytes) {
    const rotated = `${file}.1`;
    if (!legacyBoundsChecked) {
      legacyBoundsChecked = true;
      try {
        const rotatedStat = await fs.promises.stat(rotated);
        if (rotatedStat.size > logLimit) await removeFile(rotated);
      } catch (error) {
        if (error?.code !== 'ENOENT') legacyBoundsChecked = false;
      }
    }
    let stat = null;
    try { stat = await fs.promises.stat(file); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (!stat || stat.size + incomingBytes <= logLimit) return;

    await removeFile(rotated);
    if (stat.size > logLimit) {
      await removeFile(file);
      return;
    }
    try { await fs.promises.rename(file, rotated); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async function writeLine(line) {
    const file = logPath();
    const encoded = `${line}\n`;
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await rotateForAppend(file, Buffer.byteLength(encoded, 'utf8'));
    await fs.promises.appendFile(file, encoded, 'utf8');
    return true;
  }

  function appendLog(level, scope, message, detail = null) {
    const line = serializeEntry(level, scope, message, detail);
    const task = writeQueue.then(() => writeLine(line));
    writeQueue = task.catch(() => false);
    return task.catch(() => false);
  }

  function flush() {
    return writeQueue;
  }

  async function openLogFile() {
    await flush();
    const file = logPath();
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await rotateForAppend(file, 0);
      const handle = await fs.promises.open(file, 'a');
      await handle.close();
    } catch {}
    return shell?.openPath?.(file) ?? '';
  }

  return {
    safeUserDataPath,
    logPath,
    rotatedLogPath,
    appendLog,
    flush,
    openLogFile,
  };
}

module.exports = {
  DEFAULT_MAX_LOG_BYTES,
  createLogger,
  safeJsonStringify,
  sanitizeForDisk,
  sanitizeTextForDisk,
};
