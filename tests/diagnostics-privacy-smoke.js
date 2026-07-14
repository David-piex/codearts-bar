'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordBestEffortFailure, resetBestEffortStats } = require('../src/core/best-effort');
const { buildUnifiedDiagnostics, sanitizeText } = require('../src/diagnostics-report');
const { reportToText } = require('../src/diagnose');

const secretRoot = path.join(os.tmpdir(), 'Alice Secret Workspace', 'project');
const dbPath = path.join(secretRoot, 'opencode.db');
const apiSecret = 'sk-live-super-secret-value';
const bearer = 'Bearer abc.def.ghi';
const prompt = 'DO_NOT_LEAK_THIS_PROMPT';
resetBestEffortStats();
recordBestEffortFailure('fixture', new Error(`CODEARTS_CLI_SK=${apiSecret} ${dbPath} prompt="${prompt}"`));

const report = buildUnifiedDiagnostics({
  snapshot: {
    adapter: 'node:sqlite',
    health: { ok: false, issues: [{ code: 'fixture_error', tone: 'bad', title: prompt, detail: `${bearer} path=${dbPath}` }] },
  },
  database: {
    ok: false,
    error: `${prompt} api_key=${apiSecret}`,
    diagnostics: {
      runtime: { preferred: 'node:sqlite' },
      sources: [{ id: 'desktop', label: 'Desktop', dbPath, exists: true, readable: true, size: 123 }],
      issues: [{ code: 'database_error', detail: `password=hunter2 content="${prompt}" at ${dbPath}` }],
    },
  },
  runtime: { status: 'failed', issues: [{ code: 'runtime_error', message: `${bearer} ${prompt}` }], processes: `${prompt} ${dbPath}` },
  performance: {
    usageRollup: { hits: 1, pendingCount: 2, path: dbPath, prompt },
    aggregateCache: { hits: 3, misses: 4, token: apiSecret },
    slowAggregates: { count: 1, last: { scope: `${prompt}:${dbPath}` }, byLabel: { usage: { count: 1, maxMs: 2, secret: apiSecret } } },
  },
  paths: { database: dbPath, config: path.join(secretRoot, 'settings.json') },
  fs,
  path,
  version: '1.2.3',
  now: 123,
});

const serialized = JSON.stringify(report);
for (const forbidden of [secretRoot, apiSecret, bearer, prompt, 'hunter2', 'processes']) {
  assert.equal(serialized.includes(forbidden), false, `diagnostics leaked forbidden value: ${forbidden}`);
}
assert.equal(report.generatedAt, 123);
assert.equal(report.database.sources[0].dbName, 'opencode.db');
assert.match(report.database.sources[0].dbHash, /^[0-9a-f]{16}$/);
assert.equal(Object.prototype.hasOwnProperty.call(report.database.sources[0], 'dbPath'), false);
assert.equal(Object.prototype.hasOwnProperty.call(report.issues[0], 'detail'), false);
assert.equal(Object.prototype.hasOwnProperty.call(report.errorGovernance.recent[0], 'message'), false);
assert.match(sanitizeText(`Authorization: ${bearer} CODEARTS_CLI_SK=${apiSecret} ${dbPath}`), /\[redacted\].*\[path\]/);

const text = reportToText({
  ok: false,
  database: { exists: true, name: 'opencode.db', size: 123 },
  snapshot: null,
  codearts: { agent: { installed: false }, cli: { installed: false } },
  logs: { files: 0, firstTokenSignals: 0, requestLines: 0 },
  officialStatsCache: { exists: false },
  recommendations: [`Authorization: ${bearer}`, `path ${dbPath}`],
});
assert.equal(text.includes(apiSecret), false);
assert.equal(text.includes(secretRoot), false);
assert.doesNotMatch(text, /[A-Za-z]:[\\/]/);
resetBestEffortStats();
console.log('ok - diagnostics privacy smoke');
