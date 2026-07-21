'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-rollup-maintenance-'));
process.env.CODEARTS_BAR_CONFIG_DIR = tempDir;

const { maintainUsageRollupForSource } = require('../src/providers/codearts/usage-rollup-maintenance');

(async () => {
  const source = { id: 'fixture', dbPath: path.join(__dirname, 'fixtures', 'opencode-fixture.db') };
  const first = await maintainUsageRollupForSource(source, { adapter: 'node:sqlite', minNewRows: 1, cooldownMs: 0 });
  assert.equal(first.usageRollup?.built, true);
  assert.ok(Number(first.usageRollup?.rowCount || 0) > 0);

  const second = await maintainUsageRollupForSource(source, { adapter: 'node:sqlite', minNewRows: 1, cooldownMs: 0 });
  assert.equal(second.usageRollup?.status, 'maintenance-threshold');
  assert.equal(second.usageRollup?.changedRows, 0);
  assert.equal(second.usageRollup?.built, false);
  console.log('ok - rollup maintenance builds missing cache directly and bounds freshness scan');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});
