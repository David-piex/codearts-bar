'use strict';

const ASSIGNMENT = /\b(api[_-]?key|access[_-]?key|secret[_-]?key|token|password|passwd)(\s*[:=]\s*)(["']?)([^\s,;"']+)(["']?)/gi;
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET_KEY|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CLIENT_SECRET|_AK|_SK))(\s*[:=]\s*)(["']?)([^\s,;"']+)(["']?)/g;
const QUERY_SECRET = /([?&](?:api[_-]?key|access[_-]?key|token|password|client_secret)=)[^&#\s]+/gi;
const AUTHORIZATION = /\bauthorization(\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+(?=\s|$)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/gis;

function redactSensitiveText(value) {
  if (value == null || value === '') return value == null ? '' : String(value);
  return String(value)
    .replace(PRIVATE_KEY, '[private key redacted]')
    .replace(AUTHORIZATION, 'Authorization$1[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(ENV_ASSIGNMENT, '$1$2[redacted]')
    .replace(QUERY_SECRET, '$1[redacted]')
    .replace(ASSIGNMENT, '$1$2[redacted]');
}

module.exports = { redactSensitiveText };
