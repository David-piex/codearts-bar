'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DISPOSABLE_CACHE_DIRS = [
  'GPUCache',
  'Code Cache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
];

function cacheInventory(userData, fsImpl = fs) {
  return DISPOSABLE_CACHE_DIRS.map((name) => {
    const target = path.resolve(userData, name);
    try {
      const stat = fsImpl.statSync(target);
      return { name, exists: true, bytes: stat.isFile() ? stat.size : null };
    } catch {
      return { name, exists: false, bytes: null };
    }
  });
}

function clearDisposableRendererCaches(userData, fsImpl = fs) {
  const result = { removed: [], missing: [], failed: [] };
  if (!userData || !String(userData).trim()) return result;
  const root = path.resolve(String(userData));
  for (const name of DISPOSABLE_CACHE_DIRS) {
    const target = path.resolve(root, name);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      result.failed.push({ name, message: 'unsafe cache path' });
      continue;
    }
    if (!fsImpl.existsSync(target)) { result.missing.push(name); continue; }
    try {
      fsImpl.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      result.removed.push(name);
    } catch (error) {
      result.failed.push({ name, message: error.message });
    }
  }
  return result;
}

function rendererCrashDiagnostics(app, processRef = process) {
  let gpuFeatureStatus = null;
  let userData = '';
  let crashDumps = '';
  try { gpuFeatureStatus = app?.getGPUFeatureStatus?.() || null; } catch {}
  try { userData = app?.getPath?.('userData') || ''; } catch {}
  try { crashDumps = app?.getPath?.('crashDumps') || ''; } catch {}
  return {
    commandLine: [...(processRef?.execArgv || []), ...(processRef?.argv || []).slice(1)],
    gpuFeatureStatus,
    crashDumps,
    caches: userData ? cacheInventory(userData) : [],
  };
}

module.exports = { DISPOSABLE_CACHE_DIRS, cacheInventory, clearDisposableRendererCaches, rendererCrashDiagnostics };
