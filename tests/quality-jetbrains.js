'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const baseline = require('../quality-baseline.json');
const name = `codearts-bar-jetbrains-${version}.zip`;
const file = path.join(root, 'jetbrains-plugin', 'build', 'distributions', name);
assert.equal(fs.existsSync(file), true, `missing current JetBrains artifact ${name}`);
const bytes = fs.statSync(file).size;
assert.ok(bytes > 0, `${name} must not be empty`);
assert.ok(bytes <= baseline.limits.jetbrainsZipBytesMax, `${name} ${bytes} exceeds ${baseline.limits.jetbrainsZipBytesMax}`);
console.log(`ok - JetBrains quality artifact=${name} bytes=${bytes}`);
