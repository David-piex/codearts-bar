'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-self-test-config-'));
const args = [path.join(root, 'src', 'cli.js'), 'self-test', '--fixture-db', fixtureDb, '--config-dir', configDir, '--now-ms', '1783512000000'];
const env = {
  ...process.env,
  CODEARTS_BAR_DB: path.join(root, 'tests', 'fixtures', 'must-not-be-used.db'),
  CODEARTS_BAR_CONFIG_DIR: path.join(root, '.cache', 'must-not-be-used'),
  CODEARTS_BAR_NOW_MS: '1',
};
const result = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  timeout: 30000,
  env,
});
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /ok - has db path/);
assert.match(result.stdout, /ok - fixture snapshot messages=/);
assert.doesNotMatch(result.stdout, /fixture-model|multi-model|ses_multi|最近会话|模型排行/);
assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(root.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));

const denied = spawnSync(process.execPath, [path.join(root, 'src', 'cli.js'), 'self-test'], { cwd: root, encoding: 'utf8', timeout: 30000, env });
assert.equal(denied.status, 1);
assert.match(denied.stderr, /requires --fixture-db/);
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert.doesNotMatch(readme, /codearts-bar self-test\s+#\s*验证当前机器的真实数据读取/);
assert.match(readme, /self-test[^\n]*隔离 fixture/);
assert.match(readme, /拒绝读取真实用户数据库/);
fs.rmSync(configDir, { recursive: true, force: true });
console.log('ok - cli self-test fixture');
