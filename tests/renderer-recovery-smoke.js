'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DISPOSABLE_CACHE_DIRS, clearDisposableRendererCaches, rendererCrashDiagnostics } = require('../src/main/renderer-recovery');
const { resolveRuntimeDataDir, migratePersistentUserData } = require('../src/main/user-data');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-recovery-'));
try {
  const oldDir = path.join(root, 'old-user-data');
  const userData = path.join(root, 'CodeArtsBar');
  fs.mkdirSync(path.join(oldDir, 'Local Storage'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'Local Storage', 'state'), 'selection', 'utf8');
  fs.writeFileSync(path.join(oldDir, 'Preferences'), '{"theme":"system"}', 'utf8');
  fs.mkdirSync(path.join(oldDir, 'GPUCache'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'GPUCache', 'bad.bin'), 'bad-cache', 'utf8');
  const migration = migratePersistentUserData(oldDir, userData);
  assert.ok(migration.copied.includes('Local Storage'));
  assert.ok(migration.copied.includes('Preferences'));
  assert.equal(fs.existsSync(path.join(userData, 'GPUCache')), false, 'migration must not carry renderer caches');

  for (const name of DISPOSABLE_CACHE_DIRS) {
    fs.mkdirSync(path.join(userData, name), { recursive: true });
    fs.writeFileSync(path.join(userData, name, 'cache.bin'), name, 'utf8');
  }
  fs.writeFileSync(path.join(userData, 'settings.json'), '{"dailyLimit":1}', 'utf8');
  fs.writeFileSync(path.join(userData, 'Preferences'), '{"theme":"system"}', 'utf8');
  const result = clearDisposableRendererCaches(userData);
  assert.deepEqual(result.removed.sort(), [...DISPOSABLE_CACHE_DIRS].sort());
  for (const name of DISPOSABLE_CACHE_DIRS) assert.equal(fs.existsSync(path.join(userData, name)), false, `${name} should be removed`);
  assert.equal(fs.existsSync(path.join(userData, 'settings.json')), true, 'settings must survive recovery');
  assert.equal(fs.existsSync(path.join(userData, 'Preferences')), true, 'preferences must survive recovery');
  assert.deepEqual(clearDisposableRendererCaches(''), { removed: [], missing: [], failed: [] });

  const diagnostics = rendererCrashDiagnostics({
    getPath(name) { return name === 'crashDumps' ? path.join(userData, 'Crashpad') : userData; },
    getGPUFeatureStatus() { return { gpu_compositing: 'disabled_software' }; },
  }, { execArgv: ['--inspect=0'], argv: ['electron', '--open-dashboard'] });
  assert.equal(diagnostics.crashDumps, path.join(userData, 'Crashpad'));
  assert.equal(diagnostics.gpuFeatureStatus.gpu_compositing, 'disabled_software');
  assert.deepEqual(diagnostics.commandLine, ['--inspect=0', '--open-dashboard']);

  assert.equal(resolveRuntimeDataDir({ APPDATA: path.join(root, 'Roaming') }, root), path.join(root, 'Roaming', 'CodeArtsBar'));
  assert.equal(resolveRuntimeDataDir({}, root, 'win32'), path.join(root, 'AppData', 'Roaming', 'CodeArtsBar'));
  assert.equal(resolveRuntimeDataDir({}, root, 'darwin'), path.join(root, 'Library', 'Application Support', 'CodeArtsBar'));
  assert.equal(resolveRuntimeDataDir({ XDG_CONFIG_HOME: path.join(root, 'xdg') }, root, 'linux'), path.join(root, 'xdg', 'CodeArtsBar'));
  assert.equal(resolveRuntimeDataDir({ PORTABLE_EXECUTABLE_DIR: path.join(root, 'portable') }, root), path.join(root, 'portable', 'CodeArtsBarData'));
  console.log('ok - renderer recovery and user-data migration');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
