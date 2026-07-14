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
      fs.renameSync(target, backup);
      movedTarget = true;
    }
    fs.renameSync(staging, target);
  } catch (error) {
    if (movedTarget && !fs.existsSync(target) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, target); } catch (restoreError) { error.restoreError = restoreError; }
    }
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  return target;
}

module.exports = { atomicReplaceReleaseDir, cleanManagedReleaseDir, isManagedReleaseEntry };
