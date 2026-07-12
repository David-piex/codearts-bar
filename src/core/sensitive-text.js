'use strict';

const ASSIGNMENT = /\b(api[_-]?key|access[_-]?key|secret[_-]?key|token|password|passwd)(\s*[:=]\s*)(["']?)([^\s,;"']+)(["']?)/gi;
const AUTHORIZATION = /\bauthorization(\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+(?=\s|$)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/gis;

function redactSensitiveText(value) {
  if (value == null || value === '') return value == null ? '' : String(value);
  return String(value)
    .replace(PRIVATE_KEY, '[private key redacted]')
    .replace(AUTHORIZATION, 'Authorization$1[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(ASSIGNMENT, '$1$2[redacted]');
}

module.exports = { redactSensitiveText };
