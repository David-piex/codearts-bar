'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { jetbrainsPayload } = require('../src/jetbrains-payload');

const payload = jetbrainsPayload({
  ok: true, timestamp: 123, updatedAt: 'now', dbPath: 'db', dbSize: 10, adapter: 'node:sqlite',
  usage: { today: { total: 20 }, window: { total: 30 } },
  trends: { hourly24h: [{ start: 1, total: 20 }], daily14d: [] },
  models: [{ name: 'model', total: 20 }], sourceStats: [{ key: 'local', total: 20 }],
  sessions: [{ id: 'visible', archived: false }, { id: 'archived', archived: true }],
  requestLog: [{ id: 'request' }], health: { level: 'ok' }, quota: { primary: { used: 20 } },
});
assert.equal(payload.protocolVersion, 1);
assert.equal(payload.generatedAt, 123);
assert.equal(payload.data.sessions.length, 1);
assert.equal(payload.data.sessions[0].id, 'visible');
assert.equal(payload.data.requests[0].id, 'request');
assert.equal(payload.data.sources[0].key, 'local');
const failed = jetbrainsPayload({ ok: false, error: 'broken' });
assert.equal(failed.ok, false);
assert.equal(failed.error, 'broken');
const cliOutput = execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'jetbrains'], {
  encoding: 'utf8',
  env: { ...process.env, CODEARTS_BAR_DB: path.join(__dirname, 'fixtures', 'opencode-fixture.db') },
});
const cliPayload = JSON.parse(cliOutput);
assert.equal(cliPayload.protocolVersion, 1);
assert.equal(cliPayload.ok, true);
assert.ok(Array.isArray(cliPayload.data.models));
assert.ok(Array.isArray(cliPayload.data.sessions));
assert.ok(Array.isArray(cliPayload.data.requests));
const pageOutput = execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'query', 'sessions', '--page', '1', '--page-size', '1'], { encoding: 'utf8', env: { ...process.env, CODEARTS_BAR_DB: path.join(__dirname, 'fixtures', 'opencode-fixture.db') } });
const pagePayload = JSON.parse(pageOutput);
assert.equal(pagePayload.protocolVersion, 1);
assert.equal(pagePayload.data.pageSize, 1);
assert.equal(pagePayload.data.items.length, 1);
assert.ok(pagePayload.data.total >= 2);
console.log('ok - JetBrains payload protocol v1');
