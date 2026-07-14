'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const definitions = {
  'branch-pipeline.yml': 'push',
  'master-pipeline.yml': 'push',
  'pr-pipeline.yml': 'pr',
};
const requiredCommands = [
  'export CODEARTS_BAR_DB=\"$PWD/tests/fixtures/opencode-fixture.db\"',
  'export CODEARTS_BAR_CONFIG_DIR=\"$PWD/.cache/gitee-config\"',
  'export CODEARTS_BAR_NOW_MS=\"1783512000000\"',
  'export SOURCE_DATE_EPOCH=\"1783512000\"',
  'npm ci',
  'npm audit',
  'npm test',
  'npm run metrics:check -- --skip-jetbrains',
  'npm run stress:dashboard',
  'npm run stress:pagination',
  'npm run stress:aggregation',
  'npm run build:extension',
  'npm run pack:npm',
];
for (const [name, trigger] of Object.entries(definitions)) {
  const source = fs.readFileSync(path.join(root, '.workflow', name), 'utf8');
  assert.match(source, /step:\s*build@nodejs/, `${name} must use the Node.js build step`);
  assert.match(source, /nodeVersion:\s*22\.14\.0/, `${name} must pin the verified Node.js runtime`);
  assert.doesNotMatch(source, /maven|mvn\s/i, `${name} must not contain the generated Maven template`);
  assert.ok(source.includes(`\n  ${trigger}:`), `${name} must declare its ${trigger} trigger`);
  for (const command of requiredCommands) assert.ok(source.includes(`- ${command}`), `${name} is missing ${command}`);
  assert.doesNotMatch(source, /^\s*-\s+npm run metrics:check\s*$/m, `${name} must skip the separately built JetBrains artifact on a clean Node.js runner`);
  assert.ok(source.includes('./release/codearts-bar-status.vsix'), `${name} must retain the VSIX artifact`);
  assert.ok(source.includes('./release/codearts-bar-*.tgz'), `${name} must retain the npm artifact`);
}
console.log('ok - gitee Node.js pipelines');
