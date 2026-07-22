'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const distDir = path.resolve(process.env.CODEARTS_BAR_DIST_DIR || path.join(root, 'dist'));

function findPackagedAsar(dir) {
  if (!fs.existsSync(dir)) return null;
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(file);
      else if (entry.name === 'app.asar' && /[\\/](?:resources|Resources)[\\/]app\.asar$/i.test(file)) return file;
    }
  }
  return null;
}

const file = findPackagedAsar(distDir);
assert.ok(file, `missing packaged resources/app.asar below ${distDir}`);
const bytes = fs.statSync(file).size;
assert.ok(bytes < 3 * 1024 * 1024, `app.asar should stay below 3 MiB, got ${bytes}`);
const entries = new Set(asar.listPackage(file).map((entry) => entry.replace(/^\\/, '').replace(/\\/g, '/')));
for (const rel of ['src/main.js','src/dashboard-renderer.js','src/dashboard-bundle.css','src/dashboard-theme.js','src/vendor/sql.js/sql-wasm.js','src/vendor/sql.js/sql-wasm.wasm','assets/codearts-logo-ui.png']) assert.equal(entries.has(rel), true, `app.asar should include ${rel}`);
for (const rel of ['src/build-dashboard-renderer.js','src/build-extension.js','src/prepare-extension.js','src/release.js','src/dashboard/renderer-entry.js','src/dashboard.css','node_modules/sql.js/dist/sql-asm-debug.js']) assert.equal(entries.has(rel), false, `app.asar should exclude ${rel}`);
assert.equal([...entries].filter((entry) => /sql-wasm\.(?:js|wasm)$/.test(entry)).length, 2, 'app.asar should contain exactly two sql.js runtime files');
console.log(`ok - app asar smoke entries=${entries.size} bytes=${bytes}`);

module.exports = { findPackagedAsar };
