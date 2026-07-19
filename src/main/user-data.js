'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PERSISTENT_ENTRIES = [
  'Local Storage',
  'Preferences',
  'codearts-bar.log',
  'codearts-bar.log.1',
  'codearts-bar-runtime.json',
  'codearts-bar-last-crash.json',
  'codearts-bar-renderer-error.json',
];

function resolveRuntimeDataDir(env = process.env, home = os.homedir(), platform = process.platform) {
  if (env.CODEARTS_BAR_CONFIG_DIR) return path.resolve(env.CODEARTS_BAR_CONFIG_DIR);
  if (env.PORTABLE_EXECUTABLE_DIR) return path.resolve(env.PORTABLE_EXECUTABLE_DIR, 'CodeArtsBarData');
  let base;
  if (platform === 'win32') base = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  else if (platform === 'darwin') base = path.join(home, 'Library', 'Application Support');
  else base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'CodeArtsBar');
}

function samePath(left, right, platform = process.platform) {
  const a = path.resolve(String(left || ''));
  const b = path.resolve(String(right || ''));
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function migratePersistentUserData(source, target, fsImpl = fs) {
  const result = { copied: [], skipped: [], failed: [] };
  if (!source || !target || samePath(source, target) || !fsImpl.existsSync(source)) return result;
  fsImpl.mkdirSync(target, { recursive: true });
  for (const name of PERSISTENT_ENTRIES) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    if (!fsImpl.existsSync(from) || fsImpl.existsSync(to)) { result.skipped.push(name); continue; }
    try {
      const stat = fsImpl.statSync(from);
      if (stat.isDirectory()) fsImpl.cpSync(from, to, { recursive: true, errorOnExist: false });
      else fsImpl.copyFileSync(from, to);
      result.copied.push(name);
    } catch (error) {
      result.failed.push({ name, message: error.message });
    }
  }
  return result;
}

module.exports = { PERSISTENT_ENTRIES, resolveRuntimeDataDir, samePath, migratePersistentUserData };
