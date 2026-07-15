'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const localProvider = require('../src/providers/codeartsLocal');
const extensionData = require('../src/extension-data');
const jetbrains = require('../src/providers/codearts/jetbrains-cli');
const pagination = require('../src/providers/codearts/pagination');
const { queryPayload } = require('../src/protocol/query');
const { databasePagePayload, analyticsPayload, ideDashboardPayload } = require('../src/protocol/query-results');

const fixtureDb = path.join(__dirname, 'fixtures', 'opencode-fixture.db');
const timestamp = Date.now();
const start = timestamp - 365 * 86400000;
const end = timestamp;
const range = { start, end };
const common = { dbPath: fixtureDb, useSavedSettings: false, source: 'all', model: 'all', timestamp };

function pageShape(page) {
  return { total: page.total, page: page.page, pageSize: page.pageSize, pageCount: page.pageCount, hasMore: page.hasMore, ids: page.items.map((item) => item.id) };
}

function usageShape(usage = {}) {
  return Object.fromEntries(['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'messages', 'errors']
    .map((field) => [field, Number(usage[field] || 0)]));
}

function assertPrivate(page) {
  const serialized = JSON.stringify(page);
  for (const forbidden of ['dbPath', 'prompt', 'toolInput', 'toolOutput']) assert.equal(serialized.includes(forbidden), false, `${forbidden} must not cross the IDE protocol`);
}

function assertSecretValuesAbsent(value, context) {
  const serialized = JSON.stringify(value);
  for (const secret of [
    'quoted-json-secret', 'bearer-secret-value', 'private-win-user',
    'private-linux-user', 'private-stack-frame',
  ]) assert.equal(serialized.includes(secret), false, `${context} leaked ${secret}`);
}

function createProjectFilterFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-project-filter-'));
  const dbPath = path.join(directory, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table session (
        id text primary key,
        title text,
        directory text,
        version text,
        time_created integer,
        time_updated integer,
        time_archived integer
      );
      create table message (
        id text primary key,
        session_id text,
        time_created integer,
        time_updated integer,
        data text
      );
    `);
    const insert = db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?)');
    insert.run('null-project', 'Null project', null, '1', 10, 40, null);
    insert.run('empty-project', 'Empty project', '', '1', 20, 50, null);
    insert.run('blank-project', 'Blank project', '   ', '1', 30, 60, null);
    insert.run('linked-project', 'Linked project', 'C:/linked', '1', 40, 70, null);
  } finally {
    db.close();
  }
  return { directory, dbPath };
}

async function assertUnassociatedProjectFilter() {
  const fixture = createProjectFilterFixture();
  const payload = {
    dbPath: fixture.dbPath,
    useSavedSettings: false,
    source: 'all',
    status: 'all',
    project: '__none',
    limit: 50,
    offset: 0,
  };
  try {
    const pages = [
      ['native', pagination.getSessionsPageNative(payload)],
      ['sql.js', await pagination.getSessionsPageSqlJs(payload)],
    ];
    for (const [runtime, page] of pages) {
      assert.equal(page.total, 3, `${runtime} must map __none to null and trim-empty directories`);
      assert.deepEqual(page.items.map((item) => item.id).sort(), ['blank-project', 'empty-project', 'null-project']);
      assert.ok(page.items.every((item) => item.directory == null || item.directory.trim() === ''));
    }
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
}

async function main() {
  const privateError = 'failure {"access_token":"quoted-json-secret"} Bearer bearer-secret-value at C:\\Users\\private-win-user\\project\\file.js and /home/private-linux-user/project/file.js\nprivate-stack-frame';
  const privateItem = { id: 'private', title: privateError, sessionTitle: privateError, error: privateError, stack: privateError };
  assertSecretValuesAbsent(databasePagePayload({ items: [privateItem], total: 1, limit: 50 }), 'sessions/requests');
  assertSecretValuesAbsent(analyticsPayload({ buckets: [], sourceErrors: [{ source: 'bad', message: privateError }], sourceStats: [{ source: 'good', error: privateError }] }), 'analytics');
  assertSecretValuesAbsent(ideDashboardPayload({ health: { issues: [{ message: privateError, stack: privateError }] }, sourceErrors: [{ message: privateError }] }), 'dashboard');
  const partialDashboard = ideDashboardPayload({
    sourceStats: [{ source: 'desktop' }],
    sourceErrors: [{ source: 'cli', message: 'unreadable' }],
  });
  assert.equal(partialDashboard.data.completeness.complete, false);
  assert.deepEqual(partialDashboard.data.completeness.reasons, ['source-read-failed']);
  assert.deepEqual(partialDashboard.data.completeness.sources, { expected: 2, read: 1, failed: 1, missing: 0 });

  const partialAnalytics = analyticsPayload({
    buckets: [],
    sources: [{ id: 'desktop' }],
    sourceStats: [{ source: 'desktop', total: 0, messages: 0 }],
    sourceErrors: [{ source: 'cli', message: 'unreadable' }],
  });
  assert.equal(partialAnalytics.data.completeness.complete, false);
  assert.deepEqual(partialAnalytics.data.completeness.reasons, ['source-read-failed']);
  assert.deepEqual(partialAnalytics.data.completeness.sources, { expected: 2, read: 1, failed: 1, missing: 0 });
  assert.deepEqual(
    analyticsPayload({ sourceErrors: [{ message: 'unidentified failure' }] }).data.completeness.sources,
    { expected: 1, read: 0, failed: 1, missing: 0 },
  );
  assert.deepEqual(
    analyticsPayload({
      expectedSources: [{ id: 'desktop' }, { source: 'cli' }, 'remote'],
      sources: [{ id: 'desktop' }, { id: 'cli' }],
      sourceStats: [{ source: 'desktop' }, { source: 'cli' }],
      sourceErrors: [{ source: 'cli', message: 'failed after discovery' }],
    }).data.completeness.sources,
    { expected: 3, read: 1, failed: 1, missing: 1 },
  );
  const missingCoverage = analyticsPayload({
    expectedSources: 3,
    sources: [{ id: 'desktop' }],
    sourceStats: [{ source: 'desktop' }],
  });
  assert.equal(missingCoverage.data.completeness.complete, false);
  assert.deepEqual(missingCoverage.data.completeness.reasons, ['source-coverage-missing']);
  assert.deepEqual(missingCoverage.data.completeness.sources, { expected: 3, read: 1, failed: 0, missing: 2 });

  const aggregateResult = {
    ok: true,
    timestamp: 123456,
    start: 100,
    end: 200,
    bucketMs: 100,
    buckets: [{ start: 100, total: 12, input: 7, output: 5, messages: 1 }],
    modelStats: [{ provider: 'codearts', model: 'shared-model', total: 12, input: 7, output: 5, messages: 1 }],
    sourceStats: [{ source: 'desktop', total: 12, messages: 1 }],
    expectedSources: ['desktop'],
    sessionSummary: { projects: [{ key: '__none', directory: '', count: 2, active: 2 }] },
  };
  const queryOptions = { requestId: 'shared-analytics', range: { start: 100, end: 200 }, bucketMs: 100 };
  assert.deepEqual(
    queryPayload(aggregateResult, 'analytics', queryOptions),
    analyticsPayload(aggregateResult, { ...queryOptions, generatedAt: aggregateResult.timestamp }),
    'queryPayload analytics must use the shared canonical result contract',
  );
  const filters = queryPayload(aggregateResult, 'filters', { requestId: 'shared-filters' });
  assert.equal(filters.requestId, 'shared-filters');
  assert.equal(filters.generatedAt, aggregateResult.timestamp);
  assert.deepEqual(filters.data.models, aggregateResult.modelStats);
  assert.deepEqual(filters.data.projects, [{ id: '__none', directory: '', count: 2, active: 2, archived: 0, updatedAt: 0 }]);
  assert.deepEqual(Object.keys(filters.data).sort(), ['models', 'projects']);

  await assertUnassociatedProjectFilter();

  const previous = { db: process.env.CODEARTS_BAR_DB, now: process.env.CODEARTS_BAR_NOW_MS, sqljs: process.env.CODEARTS_BAR_FORCE_SQLJS };
  process.env.CODEARTS_BAR_DB = fixtureDb;
  process.env.CODEARTS_BAR_NOW_MS = String(timestamp);
  try {
    for (const forceSqlJs of [false, true]) {
      if (forceSqlJs) process.env.CODEARTS_BAR_FORCE_SQLJS = '1'; else delete process.env.CODEARTS_BAR_FORCE_SQLJS;
      const desktop = await localProvider.getDashboardAggregates({ ...common, range, bucketMs: 86400000, disableUsageRollup: true, disableAggregateCache: true });
      const vscode = await extensionData.getExtensionDetails({ ...common, rangePreset: 'custom', range });
      const idea = await jetbrains.query('analytics', ['--source', 'all', '--model', 'all', '--start', String(start), '--end', String(end), '--bucket-ms', '86400000']);
      const ideaDashboard = await jetbrains.query('dashboard');
      assert.deepEqual(desktop.expectedSources, ['custom']);
      assert.deepEqual(usageShape(vscode.usage.range), usageShape(desktop.usage.all));
      assert.deepEqual(usageShape(idea.data.usage), usageShape(desktop.usage.all));
      assert.deepEqual(vscode.models.map((item) => item.model), desktop.modelStats.map((item) => item.model));
      assert.deepEqual(idea.data.models.map((item) => item.model), desktop.modelStats.map((item) => item.model));
      assert.deepEqual(vscode.providerStats, idea.data.providers);
      assert.deepEqual(vscode.completeness, idea.data.completeness);
      assert.equal(idea.data.completeness.complete, true);
      assert.equal(idea.data.completeness.sampled, false);
      assert.deepEqual(idea.data.completeness.reasons, []);
      assert.deepEqual(idea.data.completeness.sources, { expected: 1, read: 1, failed: 0, missing: 0 });
      assert.deepEqual(idea.data.completeness.metrics, desktop.performance.metricCompleteness);
      assertPrivate(idea.data);
      assertPrivate(ideaDashboard.data);
      assert.deepEqual(ideaDashboard.data.completeness.sources, { expected: 1, read: 1, failed: 0, missing: 0 });

      const unmatchedAnalytics = await localProvider.getDashboardAggregates({
        ...common,
        range,
        query: '___no_matching_request___',
        sessionQuery: '',
        bucketMs: 86400000,
        disableUsageRollup: true,
        disableAggregateCache: true,
      });
      assert.equal(unmatchedAnalytics.usage.all.total, 0, 'analytics query must still filter usage');
      assert.equal(unmatchedAnalytics.sessionSummary.total, 2, 'analytics query must not filter session summary');
      const sessionScopedAnalytics = await localProvider.getDashboardAggregates({
        ...common,
        range,
        query: '___no_matching_request___',
        sessionQuery: 'Multi',
        bucketMs: 86400000,
        disableUsageRollup: true,
        disableAggregateCache: true,
      });
      assert.equal(sessionScopedAnalytics.usage.all.total, 0, 'session query must not change analytics usage');
      assert.equal(sessionScopedAnalytics.sessionSummary.total, 1, 'only sessionQuery may filter session summary');

      for (const resource of ['sessions', 'requests']) {
        const method = resource === 'sessions' ? 'getSessionsPage' : 'getRequestsPage';
        const direct = await localProvider[method]({ ...common, range, limit: 1, offset: 1, status: resource === 'sessions' ? 'active' : undefined });
        const canonical = databasePagePayload(direct, { page: 2, pageSize: 1, resource, range });
        const ideaPage = await jetbrains.query(resource, ['--page', '2', '--page-size', '1', '--start', String(start), '--end', String(end)]);
        const vscodePage = databasePagePayload(direct, { page: 2, pageSize: 1, resource, range });
        assert.deepEqual(pageShape(ideaPage.data), pageShape(canonical.data), `${resource} pagination and sorting must match`);
        assert.deepEqual(pageShape(vscodePage.data), pageShape(canonical.data), `VS Code ${resource} pagination and sorting must match`);
        if (resource === 'requests') {
          assert.equal(ideaPage.data.items[0].input, canonical.data.items[0].input);
          assert.equal(ideaPage.data.items[0].output, canonical.data.items[0].output);
        }
        assertPrivate(ideaPage.data);
      }

      const project = desktop.sessionSummary.projects[0];
      const filtered = await jetbrains.query('sessions', ['--project', project.key, '--page', '1', '--page-size', '50']);
      assert.equal(filtered.data.total, project.active);
      assert.ok(filtered.data.items.every((item) => item.directory === project.directory));

      for (const scope of [
        { source: 'custom', model: 'all' },
        { source: 'all', model: desktop.modelStats[0]?.model || 'all' },
      ]) {
        const scopedDesktop = await localProvider.getDashboardAggregates({ ...common, ...scope, range, bucketMs: 86400000, disableUsageRollup: true, disableAggregateCache: true });
        const scopedVsCode = await extensionData.getExtensionDetails({ ...common, ...scope, rangePreset: 'custom', range });
        const scopedIdea = await jetbrains.query('analytics', ['--source', scope.source, '--model', scope.model, '--start', String(start), '--end', String(end), '--bucket-ms', '86400000']);
        assert.deepEqual(usageShape(scopedVsCode.usage.range), usageShape(scopedDesktop.usage.all), `VS Code usage must match Desktop for ${JSON.stringify(scope)}`);
        assert.deepEqual(usageShape(scopedIdea.data.usage), usageShape(scopedDesktop.usage.all), `JetBrains usage must match Desktop for ${JSON.stringify(scope)}`);
        assert.deepEqual(scopedVsCode.completeness, scopedIdea.data.completeness);
      }
    }
  } finally {
    for (const [key, value] of [['CODEARTS_BAR_DB', previous.db], ['CODEARTS_BAR_NOW_MS', previous.now], ['CODEARTS_BAR_FORCE_SQLJS', previous.sqljs]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
  console.log('ok - desktop/vscode/jetbrains fixture totals pagination sorting completeness privacy');
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { main };
