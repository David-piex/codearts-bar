'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../src/build-dashboard-renderer');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'src', 'dashboard-renderer.dev.js');
const map = `${output}.map`;

try {
  build({ dev: true });
  const source = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(source, /__commonJS|module\.exports|export default require/);
  assert.match(source, /sourceMappingURL=dashboard-renderer\.dev\.js\.map/);
  assert.ok(fs.statSync(map).size > 0);
  console.log('ok - dashboard development renderer is ESM with external source map');
} finally {
  fs.rmSync(output, { force: true });
  fs.rmSync(map, { force: true });
}
