'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function resolveElectronPackageRoot() {
  return path.dirname(require.resolve('electron/package.json', { paths: [root] }));
}

function installedElectronPath(packageRoot, env = process.env) {
  const pathFile = path.join(packageRoot, 'path.txt');
  if (!fs.existsSync(pathFile)) return '';
  const executableName = fs.readFileSync(pathFile, 'utf8').trim();
  if (!executableName) return '';
  const distDir = env.ELECTRON_OVERRIDE_DIST_PATH
    ? path.resolve(env.ELECTRON_OVERRIDE_DIST_PATH)
    : path.join(packageRoot, 'dist');
  const executable = path.join(distDir, executableName);
  return fs.existsSync(executable) ? executable : '';
}

function ensureElectronRuntime(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || resolveElectronPackageRoot());
  const env = options.env || process.env;
  const run = options.execFileSync || execFileSync;
  const existing = installedElectronPath(packageRoot, env);
  if (existing) return existing;

  const installer = path.join(packageRoot, 'install.js');
  if (!fs.existsSync(installer)) throw new Error(`Electron runtime installer is missing: ${installer}`);
  run(process.execPath, [installer], { cwd: root, env, stdio: 'inherit' });

  const installed = installedElectronPath(packageRoot, env);
  if (!installed) throw new Error(`Electron runtime installation completed without an executable in ${packageRoot}`);
  return installed;
}

if (require.main === module) {
  const executable = ensureElectronRuntime();
  console.log(`Electron runtime ready: ${path.relative(root, executable)}`);
}

module.exports = { ensureElectronRuntime, installedElectronPath };
