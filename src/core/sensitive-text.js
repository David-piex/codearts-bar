'use strict';

const SECRET_NAME = '(?:api[_-]?key|access[_-]?(?:key(?:[_-]?id)?|token)|secret[_-]?(?:access[_-]?)?key|refresh[_-]?token|session[_-]?token|client[_-]?secret|private[_-]?key|account[_-]?(?:password|passwd|token|secret|credentials?)|token|password|passwd|credentials?|ak|sk)';
const SENSITIVE_KEY = new RegExp(`^${SECRET_NAME}$`, 'i');
const ASSIGNMENT = new RegExp(`\\b(${SECRET_NAME})(\\s*[:=]\\s*)(["']?)([^\\s,;"']+)(["']?)`, 'gi');
const QUOTED_ASSIGNMENT = new RegExp(`(["'])(${SECRET_NAME})\\1(\\s*:\\s*)(["'])([\\s\\S]*?)\\4`, 'gi');
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET_KEY|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CLIENT_SECRET|_AK|_SK))(\s*[:=]\s*)(["']?)([^\s,;"']+)(["']?)/g;
const QUERY_SECRET = new RegExp(`([?&]${SECRET_NAME}=)[^&#\\s]+`, 'gi');
const AUTHORIZATION = /(["']?authorization["']?)(\s*[:=]\s*)(["']?)(?:Bearer\s+)?[^\s,;"']+(["']?)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/gis;

function findJsonFragmentEnd(text, start) {
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.pop() !== expected) return -1;
      if (!stack.length) return index + 1;
    }
  }
  return -1;
}

function redactJsonFragments(text) {
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const objectStart = text.indexOf('{', cursor);
    const arrayStart = text.indexOf('[', cursor);
    const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
    if (start < 0) return output + text.slice(cursor);
    output += text.slice(cursor, start);
    const end = findJsonFragmentEnd(text, start);
    if (end < 0) { output += text[start]; cursor = start + 1; continue; }
    const fragment = text.slice(start, end);
    try {
      const parsed = JSON.parse(fragment);
      output += parsed && typeof parsed === 'object'
        ? JSON.stringify(redactSensitiveValue(parsed))
        : fragment;
    } catch { output += fragment; }
    cursor = end;
  }
  return output;
}

function redactSensitiveText(value) {
  if (value == null || value === '') return value == null ? '' : String(value);
  const text = String(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return JSON.stringify(redactSensitiveValue(parsed));
  } catch {}
  return redactJsonFragments(text)
    .replace(PRIVATE_KEY, '[private key redacted]')
    .replace(QUOTED_ASSIGNMENT, '$1$2$1$3$4[redacted]$4')
    .replace(AUTHORIZATION, '$1$2$3[redacted]$4')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(ENV_ASSIGNMENT, '$1$2[redacted]')
    .replace(QUERY_SECRET, '$1[redacted]')
    .replace(ASSIGNMENT, '$1$2[redacted]');
}

function redactSensitiveValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) || /^authorization$/i.test(key) ? '[redacted]' : redactSensitiveValue(item, seen),
  ]));
}

module.exports = { redactSensitiveText, redactSensitiveValue };
