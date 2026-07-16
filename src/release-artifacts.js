'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANAGED_FILE_PATTERNS = [
  /^CodeArts-Bar-(?:Setup|Portable)-.+-x64\.exe$/i,
  /^CodeArts-Bar-.+\.(?:blockmap|yml)$/i,
  /^codearts-bar-cli(?:-standalone)?\.zip$/i,
  /^codearts-bar-.+\.tgz$/i,
  /^codearts-bar-status\.vsix$/i,
  /^codearts-bar-jetbrains-.+\.zip$/i,
  /^(?:latest\.json|SHA256SUMS\.txt|RELEASE_NOTES\.md)$/i,
];
const MANAGED_DIRECTORIES = new Set(['codearts-bar-cli', 'codearts-bar-cli-standalone']);

function waitSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(source, destination, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || (process.platform === 'win32' ? 60 : 1)));
  const delayMs = Math.max(0, Number(options.delayMs ?? 500));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { fs.renameSync(source, destination); return; }
    catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === attempts) throw error;
      waitSync(delayMs);
    }
  }
  throw lastError;
}

function isManagedReleaseEntry(name, isDirectory = false) {
  if (isDirectory) return MANAGED_DIRECTORIES.has(name);
  return MANAGED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function cleanManagedReleaseDir(releaseDir) {
  const target = path.resolve(releaseDir);
  if (!fs.existsSync(target)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (!isManagedReleaseEntry(entry.name, entry.isDirectory())) continue;
    fs.rmSync(path.join(target, entry.name), { recursive: entry.isDirectory(), force: true });
    removed.push(entry.name);
  }
  return removed.sort((a, b) => a.localeCompare(b));
}

function atomicReplaceReleaseDir(stagingDir, releaseDir, options = {}) {
  const staging = path.resolve(stagingDir);
  const target = path.resolve(releaseDir);
  if (staging === target || path.dirname(staging) !== path.dirname(target)) {
    throw new Error('Release staging and target must be different sibling directories');
  }
  if (!fs.existsSync(staging) || !fs.statSync(staging).isDirectory()) throw new Error(`Release staging directory does not exist: ${staging}`);
  const backup = options.backupDir ? path.resolve(options.backupDir) : `${target}.previous-${process.pid}`;
  if (path.dirname(backup) !== path.dirname(target) || backup === staging || backup === target) throw new Error('Release backup must be a distinct sibling directory');
  fs.rmSync(backup, { recursive: true, force: true });
  let movedTarget = false;
  try {
    if (fs.existsSync(target)) {
      renameWithRetry(target, backup, options);
      movedTarget = true;
    }
    renameWithRetry(staging, target, options);
  } catch (error) {
    if (movedTarget && !fs.existsSync(target) && fs.existsSync(backup)) {
      try { renameWithRetry(backup, target, options); } catch (restoreError) { error.restoreError = restoreError; }
    }
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  return target;
}

module.exports = { atomicReplaceReleaseDir, cleanManagedReleaseDir, isManagedReleaseEntry, renameWithRetry };
