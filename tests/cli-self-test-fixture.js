'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [path.join(root, 'src', 'cli.js'), 'self-test'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30000,
  env: {
    ...process.env,
    CODEARTS_BAR_DB: path.join(root, 'tests', 'fixtures', 'opencode-fixture.db'),
    CODEARTS_BAR_CONFIG_DIR: path.join(os.tmpdir(), 'codearts-bar-self-test-config'),
  },
});
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /ok - has db path/);
assert.match(result.stdout, /fixture-model/);
console.log('ok - cli self-test fixture');
