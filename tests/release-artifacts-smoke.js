'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicReplaceReleaseDir, cleanManagedReleaseDir, isManagedReleaseEntry } = require('../src/release-artifacts');

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

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-release-atomic-'));
  try {
    const release = path.join(parent, 'release');
    const staging = path.join(parent, '.release-staging');
    fs.mkdirSync(release);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(release, 'old.txt'), 'old');
    fs.writeFileSync(path.join(staging, 'new.txt'), 'new');
    atomicReplaceReleaseDir(staging, release);
    assert.equal(fs.readFileSync(path.join(release, 'new.txt'), 'utf8'), 'new');
    assert.equal(fs.existsSync(path.join(release, 'old.txt')), false);

    const rollbackStaging = path.join(parent, '.release-rollback');
    const occupiedBackup = path.join(parent, 'occupied-backup');
    fs.mkdirSync(rollbackStaging);
    fs.writeFileSync(path.join(rollbackStaging, 'bad.txt'), 'bad');
    fs.mkdirSync(occupiedBackup);
    const originalRename = fs.renameSync;
    let calls = 0;
    fs.renameSync = (source, target) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('simulated publish failure'), { code: 'EACCES' });
      return originalRename(source, target);
    };
    try {
      assert.throws(() => atomicReplaceReleaseDir(rollbackStaging, release, { backupDir: occupiedBackup }), /simulated publish failure/);
    } finally { fs.renameSync = originalRename; }
    assert.equal(fs.readFileSync(path.join(release, 'new.txt'), 'utf8'), 'new', 'failed publish must restore the previous release');
    assert.equal(fs.existsSync(rollbackStaging), true, 'failed staging must remain available to the caller until cleanup');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  console.log('ok - managed release cleanup');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
