'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureElectronRuntime, installedElectronPath } = require('../src/ensure-electron-runtime');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-electron-runtime-'));
const packageRoot = path.join(tempDir, 'electron');
const executableName = process.platform === 'win32' ? 'electron.exe' : 'electron';
const marker = path.join(packageRoot, 'install-count.txt');
try {
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'install.js'), `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = __dirname;
    const marker = path.join(root, 'install-count.txt');
    const count = Number(fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : 0) + 1;
    fs.writeFileSync(marker, String(count));
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', ${JSON.stringify(executableName)}), 'runtime');
    fs.writeFileSync(path.join(root, 'path.txt'), ${JSON.stringify(executableName)});
  `, 'utf8');

  assert.equal(installedElectronPath(packageRoot, {}), '');
  const expected = path.join(packageRoot, 'dist', executableName);
  assert.equal(ensureElectronRuntime({ packageRoot, env: {} }), expected);
  assert.equal(ensureElectronRuntime({ packageRoot, env: {} }), expected);
  assert.equal(fs.readFileSync(marker, 'utf8'), '1', 'an existing Electron runtime must not be installed twice');

  const brokenRoot = path.join(tempDir, 'broken-electron');
  fs.mkdirSync(brokenRoot, { recursive: true });
  fs.writeFileSync(path.join(brokenRoot, 'install.js'), '', 'utf8');
  assert.throws(
    () => ensureElectronRuntime({ packageRoot: brokenRoot, env: {} }),
    /installation completed without an executable/,
  );
  console.log('ok - Electron runtime preparation');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
