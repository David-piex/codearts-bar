'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const localProvider = require('../src/providers/codeartsLocal');
const extensionData = require('../src/extension-data');
const jetbrains = require('../src/providers/codearts/jetbrains-cli');
const { manifest, fixtureRoot, checkFixtures } = require('./make-real-fixtures');

const root = path.resolve(__dirname, '..');
const timestamp = Date.UTC(2026, 6, 8, 12, 0, 0);
const range = { start: timestamp - 30 * 86400000, end: timestamp };
const usageFields = ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'messages', 'errors'];

function usageShape(usage = {}) {
  return Object.fromEntries(usageFields.map((field) => [field, Number(usage[field] || 0)]));
}

function modelNames(models = []) {
  return models.map((item) => item.model || item.name || '').filter(Boolean).sort();
}

function pageShape(page = {}) {
  return {
    total: Number(page.total || 0),
    ids: (page.items || []).map((item) => item.id).sort(),
  };
}

function assertPrivate(value, context) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ['dbPath', 'prompt', 'toolInput', 'toolOutput']) {
    assert.equal(serialized.includes(forbidden), false, `${context} leaked ${forbidden}`);
  }
}

function cliQuery(resource, args, env) {
  const output = execFileSync(process.execPath, [path.join(root, 'src', 'cli.js'), 'query', resource, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env,
  });
  return JSON.parse(output);
}

async function assertFixture(fixture, forceSqlJs, configDir) {
  const dbPath = path.join(fixtureRoot, fixture.file);
  const runtime = forceSqlJs ? 'sql.js' : 'node:sqlite';
  const env = {
    ...process.env,
    CODEARTS_BAR_DB: dbPath,
    CODEARTS_BAR_CONFIG_DIR: configDir,
    CODEARTS_BAR_NOW_MS: String(timestamp),
    CODEARTS_BAR_FORCE_SQLJS: forceSqlJs ? '1' : '',
    CODEARTS_BAR_DISABLE_USAGE_ROLLUP: '1',
    CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD: '1',
  };
  Object.assign(process.env, env);

  const common = {
    dbPath,
    useSavedSettings: false,
    source: 'all',
    model: 'all',
    timestamp,
    range,
    bucketMs: 86400000,
    disableUsageRollup: true,
    disableAggregateCache: true,
  };
  const queryArgs = ['--source', 'all', '--model', 'all', '--start', String(range.start), '--end', String(range.end), '--bucket-ms', '86400000'];
  const pageArgs = ['--page', '1', '--page-size', '50', '--start', String(range.start), '--end', String(range.end)];

  const desktop = await localProvider.getDashboardAggregates(common);
  const vscode = await extensionData.getExtensionDetails({ ...common, rangePreset: 'custom' });
  const idea = await jetbrains.query('analytics', queryArgs);
  const cli = cliQuery('analytics', queryArgs, env);

  const expectedUsage = usageShape(fixture.expected.usage);
  assert.deepEqual(usageShape(desktop.usage.all), expectedUsage, `${fixture.id} ${runtime} Desktop expected usage`);
  assert.deepEqual(usageShape(vscode.usage.range), expectedUsage, `${fixture.id} ${runtime} VS Code usage`);
  assert.deepEqual(usageShape(idea.data.usage), expectedUsage, `${fixture.id} ${runtime} JetBrains usage`);
  assert.deepEqual(usageShape(cli.data.usage), expectedUsage, `${fixture.id} ${runtime} CLI usage`);

  const expectedModels = [...fixture.expected.models].sort();
  assert.deepEqual(modelNames(desktop.modelStats), expectedModels, `${fixture.id} ${runtime} Desktop models`);
  assert.deepEqual(modelNames(vscode.models), expectedModels, `${fixture.id} ${runtime} VS Code models`);
  assert.deepEqual(modelNames(idea.data.models), expectedModels, `${fixture.id} ${runtime} JetBrains models`);
  assert.deepEqual(modelNames(cli.data.models), expectedModels, `${fixture.id} ${runtime} CLI models`);
  assert.deepEqual(vscode.providerStats, idea.data.providers, `${fixture.id} ${runtime} provider totals`);
  assert.deepEqual(idea.data.providers, cli.data.providers, `${fixture.id} ${runtime} CLI providers`);
  assert.deepEqual(vscode.completeness, idea.data.completeness, `${fixture.id} ${runtime} completeness`);
  assert.deepEqual(idea.data.completeness, cli.data.completeness, `${fixture.id} ${runtime} CLI completeness`);

  const directSessions = await localProvider.getSessionsPage({ ...common, status: 'active', limit: 50, offset: 0 });
  const directRequests = await localProvider.getRequestsPage({ ...common, limit: 50, offset: 0 });
  const ideaSessions = await jetbrains.query('sessions', pageArgs);
  const ideaRequests = await jetbrains.query('requests', pageArgs);
  const cliSessions = cliQuery('sessions', pageArgs, env);
  const cliRequests = cliQuery('requests', pageArgs, env);

  assert.equal(directSessions.total, fixture.expected.sessions, `${fixture.id} ${runtime} session count`);
  assert.equal(directRequests.total, fixture.expected.requests, `${fixture.id} ${runtime} request count`);
  assert.deepEqual(pageShape(ideaSessions.data), pageShape(directSessions), `${fixture.id} ${runtime} JetBrains sessions`);
  assert.deepEqual(pageShape(ideaRequests.data), pageShape(directRequests), `${fixture.id} ${runtime} JetBrains requests`);
  assert.deepEqual(pageShape(cliSessions.data), pageShape(directSessions), `${fixture.id} ${runtime} CLI sessions`);
  assert.deepEqual(pageShape(cliRequests.data), pageShape(directRequests), `${fixture.id} ${runtime} CLI requests`);

  assert.equal(vscode.sessionTotal, fixture.expected.sessions, `${fixture.id} ${runtime} VS Code session count`);
  assert.equal(vscode.requestTotal, fixture.expected.requests, `${fixture.id} ${runtime} VS Code request count`);
  assert.deepEqual(vscode.sessions.map((item) => item.id).sort(), directSessions.items.map((item) => item.id).sort());
  assert.deepEqual(vscode.requests.map((item) => item.id).sort(), directRequests.items.map((item) => item.id).sort());

  assertPrivate(idea, `${fixture.id} ${runtime} JetBrains`);
  assertPrivate(cli, `${fixture.id} ${runtime} CLI`);
}

async function main() {
  await checkFixtures();
  assert.equal(manifest.sanitized, true, 'real-shape fixture manifest must declare sanitization');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-real-fixture-contract-'));
  const previous = Object.fromEntries([
    'CODEARTS_BAR_DB', 'CODEARTS_BAR_CONFIG_DIR', 'CODEARTS_BAR_NOW_MS', 'CODEARTS_BAR_FORCE_SQLJS',
    'CODEARTS_BAR_DISABLE_USAGE_ROLLUP', 'CODEARTS_BAR_DISABLE_USAGE_ROLLUP_BUILD',
  ].map((key) => [key, process.env[key]]));
  try {
    for (const fixture of manifest.fixtures) {
      for (const forceSqlJs of [false, true]) {
        await assertFixture(fixture, forceSqlJs, path.join(temp, `${fixture.id}-${forceSqlJs ? 'sqljs' : 'native'}`));
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`ok - sanitized real-shape four-client matrix fixtures=${manifest.fixtures.length} runtimes=2 clients=4`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { main };
