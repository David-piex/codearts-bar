'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  artifactNames,
  assertReleaseSource,
  releasePaths,
  releaseSourceIdentity,
  sanitizedReleaseEnv,
  selfTestArguments,
  trackedSourceHash,
  validateRequired,
} = require('../src/release');

const version = require('../package.json').version;
const releaseSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'release.js'), 'utf8');
assert.match(
  releaseSource,
  /build-session-xlsx\.js[\s\S]*build-dashboard-renderer\.js/,
  'release must rebuild the XLSX runtime before staging any client package',
);
assert.deepEqual(artifactNames(version), [
  `CodeArts-Bar-Setup-${version}-x64.exe`,
  `CodeArts-Bar-Setup-${version}-x64.exe.blockmap`,
  `CodeArts-Bar-Portable-${version}-x64.exe`,
  'codearts-bar-cli.zip',
  'codearts-bar-cli-standalone.zip',
  `codearts-bar-${version}.tgz`,
  'codearts-bar-status.vsix',
  `codearts-bar-jetbrains-${version}.zip`,
]);
const dirtySource = { commit: 'a'.repeat(40), treeSha256: 'b'.repeat(64), dirty: true, trackedFiles: 1 };
assert.throws(() => assertReleaseSource({ sourceIdentity: dirtySource }), /clean tracked worktree/);
assert.deepEqual(assertReleaseSource({ sourceIdentity: dirtySource, allowDirty: true }), dirtySource);
const actualSource = releaseSourceIdentity();
assert.match(actualSource.commit, /^[0-9a-f]{40}$/i);
assert.match(actualSource.treeSha256, /^[0-9a-f]{64}$/i);
assert.ok(actualSource.trackedFiles > 0);
assert.equal(trackedSourceHash([]).trackedFiles, 0);

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-bar-release-orchestration-'));
try {
  const paths = releasePaths({
    releaseDir: path.join(parent, 'release'),
    workDir: path.join(parent, 'work'),
    fixtureConfig: path.join(parent, 'fixture-config'),
  });
  assert.equal(path.dirname(paths.stagingDir), parent);
  assert.notEqual(paths.stagingDir, paths.releaseDir);
  assert.throws(() => releasePaths({
    releaseDir: path.join(parent, 'release'),
    stagingDir: path.join(parent, 'nested', 'staging'),
  }), /distinct sibling/);

  const env = sanitizedReleaseEnv({
    SOURCE_DATE_EPOCH: '0',
    CI: '1',
    DEMO_TOKEN: 'must-not-escape',
    CSC_LINK: 'must-not-escape',
  });
  assert.equal(env.SOURCE_DATE_EPOCH, '0');
  assert.equal(env.CI, '1');
  assert.equal(env.DEMO_TOKEN, undefined);
  assert.equal(env.CSC_LINK, undefined);
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');

  const selfTest = selfTestArguments(paths);
  assert.deepEqual(selfTest.slice(0, 2), ['self-test', '--fixture-db']);
  assert.equal(selfTest[selfTest.indexOf('--fixture-db') + 1], paths.fixtureDb);
  assert.equal(selfTest[selfTest.indexOf('--config-dir') + 1], paths.fixtureConfig);
  assert.match(selfTest[selfTest.indexOf('--now-ms') + 1], /^\d+$/);

  const empty = path.join(parent, 'empty.bin');
  fs.writeFileSync(empty, '');
  assert.throws(() => validateRequired(empty), /Missing or empty/);
  fs.writeFileSync(empty, 'ready');
  assert.equal(validateRequired(empty), empty);
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}

console.log('ok - release orchestration contract');
