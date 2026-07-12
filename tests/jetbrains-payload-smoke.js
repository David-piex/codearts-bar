'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { jetbrainsPayload } = require('../src/jetbrains-payload');
const { queryPayload, databasePagePayload } = require('../src/protocol/query');

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
const searched = queryPayload({
  ...payload.data,
  ok: true,
  sessions: [
    { id: 's1', title: 'Alpha', directory: 'D:/one' },
    { id: 's2', title: 'Beta', directory: 'D:/two' },
  ],
}, 'sessions', { query: 'beta', page: 1, pageSize: 1 });
assert.equal(searched.data.total, 1);
assert.equal(searched.data.items[0].id, 's2');
assert.equal(searched.data.hasMore, false);
const dbPage = databasePagePayload({
  limit: 2, offset: 2, total: 5, hasMore: true,
  items: [{ id: 's3', dbPath: 'D:/private/opencode.db' }, { id: 's4' }],
}, { page: 2, pageSize: 2 });
assert.equal(dbPage.data.page, 2);
assert.equal(dbPage.data.pageCount, 3);
assert.equal(dbPage.data.hasMore, true);
assert.equal('dbPath' in dbPage.data.items[0], false);
assert.equal(queryPayload({ ...payload.data, ok: true }, 'sessions', { page: 1.5, pageSize: 1.8 }).data.page, 1);
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
assert.equal(typeof pagePayload.data.hasMore, 'boolean');
const futurePageOutput = execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'query', 'sessions', '--start', '9999999999999'], { encoding: 'utf8', env: { ...process.env, CODEARTS_BAR_DB: path.join(__dirname, 'fixtures', 'opencode-fixture.db') } });
const futurePage = JSON.parse(futurePageOutput);
assert.equal(futurePage.data.total, 0);
assert.equal(futurePage.data.items.length, 0);
const analyticsOutput = execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'query', 'analytics', '--start', '1', '--end', '9999999999999', '--bucket-ms', '86400000'], { encoding: 'utf8', env: { ...process.env, CODEARTS_BAR_DB: path.join(__dirname, 'fixtures', 'opencode-fixture.db') } });
const analyticsPage = JSON.parse(analyticsOutput);
assert.equal(analyticsPage.data.usage.total, 220);
assert.equal(analyticsPage.data.models.length, 2);
assert.equal(analyticsPage.data.sources.length, 1);
assert.equal(analyticsPage.data.trend.length, 1);
const fractionalPageOutput = execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'query', 'sessions', '--page', '1.5', '--page-size', '1.8'], { encoding: 'utf8', env: { ...process.env, CODEARTS_BAR_DB: path.join(__dirname, 'fixtures', 'opencode-fixture.db') } });
const fractionalPage = JSON.parse(fractionalPageOutput);
assert.equal(fractionalPage.data.page, 1);
assert.equal(fractionalPage.data.pageSize, 1);
const failureResult = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'query', 'sessions'], { encoding: 'utf8', env: { ...process.env, CODEARTS_BAR_DB: path.join(__dirname, 'fixtures', 'missing.db') } });
assert.notEqual(failureResult.status, 0);
const failurePayload = JSON.parse(failureResult.stdout);
assert.equal(failurePayload.protocolVersion, 1);
assert.equal(failurePayload.ok, false);
assert.match(failurePayload.error, /不存在|no such file|ENOENT/i);
console.log('ok - JetBrains payload protocol v1');
