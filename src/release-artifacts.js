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

module.exports = { cleanManagedReleaseDir, isManagedReleaseEntry };
