'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ExcelJS = require('../src/vendor/session-xlsx');
const { databasePagePayload: canonicalDatabasePagePayload } = require('../src/protocol/query');
const { ideDashboardPayload } = require('../src/protocol/query-results');
const {
  dashboardSnapshot,
  dashboardPayload,
  databasePagePayload: jetbrainsDatabasePagePayload,
} = require('../src/providers/codearts/jetbrains-cli');

const root = path.resolve(__dirname, '..');
const qualityBaseline = require('../quality-baseline.json');
const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-jetbrains-cli-'));
const runtimeDir = path.join(temp, 'runtime');
const configDir = path.join(temp, 'config');

const contractSnapshot = dashboardSnapshot({
  usage: { today: { total: 20 }, window: { total: 30 }, week: { total: 40 }, all: { total: 50 } },
  sources: [{ id: 'custom', label: '自定义', dbPath: fixtureDb }],
  sourceStats: [{ key: 'custom', total: 50 }], modelStats: [{ name: 'model', total: 50 }], buckets: [],
  sessionSummary: { total: 2, active: 2 }, sourceErrors: [],
}, 1783512000000, { dailyLimit: 1000, windowHours: 48 });
const contractOptions = { page: 1, pageSize: 50, range: { start: 1, end: 2 }, generatedAt: 1783512000000 };
assert.deepEqual(dashboardPayload(contractSnapshot, contractOptions), ideDashboardPayload(contractSnapshot, contractOptions));
const pageContract = { limit: 2, offset: 2, total: 5, hasMore: true, items: [{ id: 's3', dbPath: 'private' }] };
assert.deepEqual(jetbrainsDatabasePagePayload(pageContract, contractOptions), canonicalDatabasePagePayload(pageContract, contractOptions));
assert.equal(dashboardSnapshot({ sources: [] }, 1783512000000, { dailyLimit: 1000, windowHours: 48 }).dbSize, 0);

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

async function main() {
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
  assert.deepEqual(manifest.files, [
    'src/protocol/query-results.js',
    'src/providers/codearts/jetbrains-cli.js',
    'src/providers/codearts/session-export-cli.js',
  ]);
  assert.equal(fs.existsSync(path.join(runtimeDir, '.bundle-src')), false);
  const entry = path.join(runtimeDir, ...manifest.entry.split('/'));
  const entrySource = fs.readFileSync(entry, 'utf8');
  assert.match(entrySource, /require\(["']sql\.js["']\)/, 'bundled CLI must load the packaged sql.js runtime as an external dependency');
  assert.equal(entrySource.includes('sql.js is a port of SQLite'), false, 'bundled CLI must not embed the sql.js implementation');
  assert.ok(
    fs.statSync(entry).size <= qualityBaseline.limits.jetbrainsQueryBundleBytesMax,
    `bundled CLI must stay within ${qualityBaseline.limits.jetbrainsQueryBundleBytesMax} bytes`,
  );
  const exportEntry = path.join(runtimeDir, 'src', 'providers', 'codearts', 'session-export-cli.js');
  assert.equal(fs.existsSync(exportEntry), true, 'bundled runtime must include the separate session exporter');
  const runtimeJsBytes = manifest.files
    .filter((relative) => relative.endsWith('.js'))
    .reduce((sum, relative) => sum + fs.statSync(path.join(runtimeDir, ...relative.split('/'))).size, 0);
  assert.ok(
    runtimeJsBytes <= qualityBaseline.limits.jetbrainsRuntimeJsBytesMax,
    `bundled runtime JS must stay within ${qualityBaseline.limits.jetbrainsRuntimeJsBytesMax} bytes`,
  );

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
    assert.equal('dbPath' in dashboard.data, false);
    assert.equal(dashboard.data.adapter, forceSqlJs ? 'sql.js' : 'node:sqlite');

    const historicalDashboard = run(entry, ['query', 'dashboard', '--start', '1', '--end', '1700000000000'], forceSqlJs);
    assert.equal(historicalDashboard.generatedAt, 1783512000000);
    assert.deepEqual(historicalDashboard.data.status, dashboard.data.status);
    assert.deepEqual(historicalDashboard.data.quota, dashboard.data.quota);

    const analytics = run(entry, ['query', 'analytics', '--start', '1', '--end', '9999999999999', '--bucket-ms', '86400000'], forceSqlJs);
    assert.equal(analytics.data.usage.total, 220);
    assert.equal(analytics.data.trend.length, 1);
    assert.equal(analytics.data.models.length, 2);
    assert.equal(analytics.data.providers.length, 1);
    assert.equal(analytics.data.sources.length, 1);
    assert.equal(analytics.data.performance.samples, 3);
    assert.equal(analytics.data.completeness.complete, true);

    const filters = run(entry, ['query', 'filters'], forceSqlJs);
    assert.equal(filters.ok, true);
    assert.equal(filters.data.models.length, 2);
    assert.equal(filters.data.projects.length > 0, true);
    assert.equal(typeof filters.data.projects[0].id, 'string');

    const diagnostics = run(entry, ['query', 'diagnostics'], forceSqlJs);
    assert.equal(diagnostics.ok, true);
    assert.equal(diagnostics.data.items.length, 1);
    assert.equal(diagnostics.data.items[0].quickCheck, 'ok');
    assert.equal(diagnostics.data.items[0].sessionCount, 2);
    assert.equal(diagnostics.data.items[0].messageCount, 5);
    assert.equal('dbPath' in diagnostics.data.items[0], false);

    const sessions = run(entry, ['query', 'sessions', '--page', '1', '--page-size', '1'], forceSqlJs);
    assert.equal(sessions.data.total, 2);
    assert.equal(sessions.data.items.length, 1);

    const requests = run(entry, ['query', 'requests', '--page', '1', '--page-size', '1'], forceSqlJs);
    assert.equal(requests.data.total, 3);
    assert.equal(requests.data.items.length, 1);
    assert.equal(typeof requests.data.items[0].input, 'number');
    assert.equal(typeof requests.data.items[0].output, 'number');
    assert.equal(typeof requests.data.items[0].cacheWrite, 'number');

    const multiModel = run(entry, ['query', 'analytics', '--start', '1', '--end', '9999999999999', '--model', 'fixture-model', '--model', 'multi-model'], forceSqlJs);
    assert.equal(multiModel.ok, true);
    assert.equal(multiModel.data.models.length, 2, 'repeated model arguments must use OR semantics');

    const projectAnalytics = run(entry, ['query', 'analytics', '--start', '1', '--end', '9999999999999', '--project', 'C:/fixture'], forceSqlJs);
    assert.equal(projectAnalytics.data.usage.total, 220, 'analytics must apply a matching project scope');
    const missingProjectAnalytics = run(entry, ['query', 'analytics', '--start', '1', '--end', '9999999999999', '--project', 'C:/missing'], forceSqlJs);
    assert.equal(missingProjectAnalytics.data.usage.total, 0, 'analytics must not ignore an unmatched project scope');
  }

  const sessions = run(entry, ['query', 'sessions', '--page', '1', '--page-size', '1'], false);
  const sessionId = sessions.data.items[0].id;
  const allSessions = run(entry, ['query', 'sessions', '--page', '1', '--page-size', '10'], false).data.items;
  for (const forceSqlJs of [false, true]) {
    for (const format of ['json', 'md', 'xlsx']) {
      const outputPath = path.join(temp, `session-${forceSqlJs ? 'sqljs' : 'native'}.${format}`);
      const result = run(exportEntry, [
        'export-session', '--session-id', sessionId, '--format', format, '--output', outputPath,
      ], forceSqlJs);
      assert.equal(result.ok, true);
      assert.equal(result.format, format);
      assert.equal(fs.statSync(outputPath).size > 100, true);
      if (format === 'json') assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).session.id, sessionId);
      if (format === 'md') assert.match(fs.readFileSync(outputPath, 'utf8'), /^# /);
      if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(outputPath);
        assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Messages', 'Requests', 'Tools']);
      }
    }
  }

  for (const forceSqlJs of [false, true]) {
    for (const format of ['json', 'md', 'xlsx']) {
      const outputPath = path.join(temp, `sessions-${forceSqlJs ? 'sqljs' : 'native'}.${format}`);
      const args = ['export-sessions'];
      for (const session of allSessions) args.push('--session-id', session.id, '--session-source', session.source);
      args.push('--format', format, '--output', outputPath);
      const result = run(exportEntry, args, forceSqlJs);
      assert.equal(result.ok, true);
      assert.equal(result.sessions, allSessions.length);
      if (format === 'json') {
        const batch = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        assert.equal(batch.kind, 'session-batch');
        assert.equal(batch.sessions.length, allSessions.length);
      }
      if (format === 'md') assert.match(fs.readFileSync(outputPath, 'utf8'), /^# CodeArts 会话批量导出/);
      if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(outputPath);
        assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Sessions', 'Messages', 'Requests', 'Tools']);
      }
    }
  }

  const failed = spawnSync(process.execPath, [entry, 'query', 'dashboard'], {
    cwd: runtimeDir,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, CODEARTS_BAR_DB: path.join(temp, 'private', 'missing.db') },
  });
  assert.notEqual(failed.status, 0);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.error, 'custom: 数据源 数据库不存在');
  assert.doesNotMatch(failure.error, /private|missing\.db/i);
  for (const relative of manifest.files) {
    const bytes = fs.readFileSync(path.join(runtimeDir, ...relative.split('/')));
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      manifest.hashes[relative],
      `manifest hash mismatch: ${relative}`,
    );
  }
  console.log('ok - bundled JetBrains CLI native/sql.js query and export contract');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
}

main().catch((error) => { console.error(error); process.exit(1); });
