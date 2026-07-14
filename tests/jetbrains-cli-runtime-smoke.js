'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-jetbrains-cli-'));
const runtimeDir = path.join(temp, 'runtime');
const configDir = path.join(temp, 'config');

function run(entry, args, forceSqlJs) {
  const output = execFileSync(process.execPath, [entry, ...args], {
    cwd: runtimeDir,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CODEARTS_BAR_DB: fixtureDb,
      CODEARTS_BAR_CONFIG_DIR: configDir,
      CODEARTS_BAR_NOW_MS: '1783512000000',
      CODEARTS_BAR_DAILY_LIMIT: '1000',
      CODEARTS_BAR_WINDOW_HOURS: '48',
      CODEARTS_BAR_FORCE_SQLJS: forceSqlJs ? '1' : '',
    },
  });
  return JSON.parse(output);
}

try {
  execFileSync(process.execPath, [path.join(root, 'src', 'build-cli-resources.js')], {
    cwd: root,
    stdio: 'pipe',
    timeout: 30000,
    env: {
      ...process.env,
      CODEARTS_BAR_CLI_ENTRY: 'src/providers/codearts/jetbrains-cli.js',
      CODEARTS_BAR_CLI_RUNTIME_DIR: runtimeDir,
      CODEARTS_BAR_CLI_BUNDLE: '1',
    },
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'CLI_RUNTIME_MANIFEST.json'), 'utf8'));
  assert.equal(manifest.entry, 'src/providers/codearts/jetbrains-cli.js');
  assert.deepEqual(manifest.files, ['src/providers/codearts/jetbrains-cli.js']);
  const entry = path.join(runtimeDir, ...manifest.entry.split('/'));
  assert.equal(fs.statSync(entry).size < 125000, true, 'bundled CLI must reuse the packaged sql.js runtime instead of embedding a duplicate');

  for (const forceSqlJs of [false, true]) {
    const dashboard = run(entry, ['query', 'dashboard'], forceSqlJs);
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.data.usage.all.total, 220);
    assert.equal(dashboard.data.sessionSummary.total, 2);
    assert.equal(dashboard.data.config.dailyLimit, 1000);
    assert.equal(dashboard.data.config.windowHours, 48);
    assert.equal(dashboard.data.status.usagePercent, 0);
    assert.equal(dashboard.data.quota.primary.limit, 1000);
    assert.equal(dashboard.data.dbSize > 0, true);
    assert.equal(dashboard.data.adapter, forceSqlJs ? 'sql.js' : 'node:sqlite');

    const analytics = run(entry, ['query', 'analytics', '--start', '1', '--end', '9999999999999', '--bucket-ms', '86400000'], forceSqlJs);
    assert.equal(analytics.data.usage.total, 220);
    assert.equal(analytics.data.trend.length, 1);
    assert.equal(analytics.data.models.length, 2);
    assert.equal(analytics.data.sources.length, 1);

    const sessions = run(entry, ['query', 'sessions', '--page', '1', '--page-size', '1'], forceSqlJs);
    assert.equal(sessions.data.total, 2);
    assert.equal(sessions.data.items.length, 1);

    const requests = run(entry, ['query', 'requests', '--page', '1', '--page-size', '1'], forceSqlJs);
    assert.equal(requests.data.total, 3);
    assert.equal(requests.data.items.length, 1);
  }
  console.log('ok - bundled JetBrains CLI native/sql.js query contract');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
