'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanManagedReleaseDir, isManagedReleaseEntry } = require('../src/release-artifacts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-release-clean-'));
try {
  const managed = [
    'CodeArts-Bar-Setup-1.0.0-x64.exe',
    'CodeArts-Bar-Portable-0.9.0-x64.exe',
    'codearts-bar-cli.zip',
    'codearts-bar-cli-standalone.zip',
    'codearts-bar-0.9.0.tgz',
    'codearts-bar-status.vsix',
    'codearts-bar-jetbrains-0.9.0.zip',
    'latest.json',
    'SHA256SUMS.txt',
    'RELEASE_NOTES.md',
  ];
  for (const name of managed) fs.writeFileSync(path.join(dir, name), name);
  for (const name of ['codearts-bar-cli', 'codearts-bar-cli-standalone']) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'fixture.txt'), 'fixture');
  }
  fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'keep');
  const removed = cleanManagedReleaseDir(dir);
  assert.equal(removed.length, managed.length + 2);
  assert.equal(fs.existsSync(path.join(dir, 'keep-me.txt')), true);
  assert.equal(isManagedReleaseEntry('notes.txt'), false);
  assert.equal(isManagedReleaseEntry('codearts-bar-cli', true), true);
  console.log('ok - managed release cleanup');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
