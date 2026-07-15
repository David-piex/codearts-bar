'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeReleaseManifest, verifyReleaseManifest } = require('./release-manifest');
const { atomicReplaceReleaseDir } = require('./release-artifacts');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
const FIXTURE_NOW_MS = Date.UTC(2026, 6, 8, 12, 0, 0);

function sourceDateEpoch() {
  const configured = Number(process.env.SOURCE_DATE_EPOCH || 0);
  if (Number.isFinite(configured) && configured > 0) return String(Math.trunc(configured));
  try {
    const value = execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    if (/^\d+$/.test(value)) return value;
  } catch {}
  return String(Math.trunc(FIXTURE_NOW_MS / 1000));
}

function sanitizedReleaseEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE|CREDENTIAL|API.?KEY|ACCESS.?KEY|CLIENT.?SECRET|(?:^|_)AK$|(?:^|_)SK$|CSC_LINK|CSC_KEY_PASSWORD)/i.test(key)) delete env[key];
  }
  env.SOURCE_DATE_EPOCH = String(overrides.SOURCE_DATE_EPOCH || sourceDateEpoch());
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  return env;
}

function displayArg(value) {
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function run(command, args, options = {}) {
  console.log(`> ${path.basename(command)} ${args.map(displayArg).join(' ')}`);
  execFileSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd || root,
    shell: false,
    windowsHide: true,
    env: sanitizedReleaseEnv(options.env || {}),
  });
}

function runNode(script, args = [], options = {}) {
  run(process.execPath, [script, ...args], options);
}

function copyRequired(source, destination) {
  let stat = null;
  try { stat = fs.statSync(source); } catch {}
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`Missing or empty required release artifact: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

function validateRequired(file) {
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`Missing or empty required release artifact: ${file}`);
  return file;
}

function writeText(file, content, encoding = 'utf8') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, encoding);
}

function nodeSupportsNativeSqlite() {
  try { return Boolean(require('node:sqlite').DatabaseSync); }
  catch { return false; }
}

function artifactNames(version = pkg.version) {
  return [
    `CodeArts-Bar-Setup-${version}-x64.exe`,
    `CodeArts-Bar-Setup-${version}-x64.exe.blockmap`,
    `CodeArts-Bar-Portable-${version}-x64.exe`,
    'codearts-bar-cli.zip',
    'codearts-bar-cli-standalone.zip',
    `codearts-bar-${version}.tgz`,
    'codearts-bar-status.vsix',
    `codearts-bar-jetbrains-${version}.zip`,
  ];
}

function prepareCliPackage(target, cliRuntime, { bundleNode = false } = {}) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(cliRuntime, target, { recursive: true });
  for (const file of ['README.md', 'LICENSE']) copyRequired(path.join(root, file), path.join(target, file));
  writeText(path.join(target, 'codearts-bar.cmd'), '@echo off\r\nsetlocal\r\nset "APPDIR=%~dp0"\r\nset "NODE=%APPDIR%node.exe"\r\nif exist "%NODE%" (\r\n  "%NODE%" "%APPDIR%src\\bin.js" %*\r\n) else (\r\n  node "%APPDIR%src\\bin.js" %*\r\n)\r\nexit /b %ERRORLEVEL%\r\n', 'ascii');
  writeText(path.join(target, 'codearts-bar.ps1'), `$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $appDir 'node.exe'
$cli = Join-Path $appDir 'src\\bin.js'
if (Test-Path -LiteralPath $node) { & $node $cli @args } else { & node $cli @args }
exit $LASTEXITCODE
`);
  writeText(path.join(target, 'CLI_RUNTIME.md'), bundleNode
    ? '# CodeArts Bar CLI Standalone\n\nIncludes a private Node.js runtime. Run codearts-bar.cmd or codearts-bar.ps1.\n'
    : '# CodeArts Bar CLI\n\nRequires Node.js 18 or newer. Run codearts-bar.cmd or codearts-bar.ps1.\n');
  if (bundleNode) copyRequired(process.execPath, path.join(target, 'node.exe'));
}

function compressDirectoryContents(sourceDir, destination) {
  fs.rmSync(destination, { force: true });
  const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const command = `Compress-Archive -Path ${quotePowerShell(path.join(sourceDir, '*'))} -DestinationPath ${quotePowerShell(destination)} -CompressionLevel Optimal -Force`;
  run('powershell.exe', ['-NoProfile', '-Command', command]);
  validateRequired(destination);
}

function removeCurrentDesktopOutputs(distDir, version = pkg.version) {
  for (const name of [
    `CodeArts-Bar-Setup-${version}-x64.exe`,
    `CodeArts-Bar-Setup-${version}-x64.exe.blockmap`,
    `CodeArts-Bar-Portable-${version}-x64.exe`,
  ]) fs.rmSync(path.join(distDir, name), { force: true });
}

function selfTestArguments(paths) {
  return [
    'self-test',
    '--fixture-db', paths.fixtureDb,
    '--config-dir', paths.fixtureConfig,
    '--now-ms', String(FIXTURE_NOW_MS),
  ];
}

function releasePaths(options = {}) {
  const releaseDir = path.resolve(options.releaseDir || path.join(root, 'release'));
  const stagingDir = path.resolve(options.stagingDir || path.join(path.dirname(releaseDir), `.${path.basename(releaseDir)}.staging-${process.pid}`));
  if (path.dirname(stagingDir) !== path.dirname(releaseDir) || stagingDir === releaseDir) throw new Error('Release staging must be a distinct sibling of release');
  const workDir = path.resolve(options.workDir || path.join(root, '.cache', `release-work-${process.pid}`));
  return {
    releaseDir,
    stagingDir,
    distDir: path.resolve(options.distDir || path.join(workDir, 'dist')),
    workDir,
    fixtureDb: path.join(root, 'tests', 'fixtures', 'opencode-fixture.db'),
    fixtureConfig: path.resolve(options.fixtureConfig || path.join(root, '.cache', `release-self-test-${process.pid}`)),
  };
}

function validateArchiveEntries(file, requiredEntries) {
  const list = execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-tf', file], { encoding: 'utf8', windowsHide: true });
  const entries = list.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, ''));
  for (const required of requiredEntries) {
    if (!entries.some((entry) => entry === required || entry.endsWith(`/${required}`))) throw new Error(`${path.basename(file)} is missing required entry ${required}`);
  }
  return entries;
}

function buildRelease(options = {}) {
  const paths = releasePaths(options);
  const names = artifactNames(pkg.version);
  const jetbrainsName = `codearts-bar-jetbrains-${pkg.version}.zip`;
  const jetbrainsArtifact = path.join(root, 'jetbrains-plugin', 'build', 'distributions', jetbrainsName);
  const cliRuntime = path.join(root, '.cache', 'cli-runtime');
  const extensionStaging = path.join(root, '.cache', 'extension-staging');
  const npmStaging = path.join(root, '.cache', 'npm-package');
  const builderConfig = path.join(paths.workDir, 'electron-builder.release.json');
  const releaseEnv = { SOURCE_DATE_EPOCH: sourceDateEpoch(), CODEARTS_BAR_NOW_MS: String(FIXTURE_NOW_MS) };

  fs.rmSync(paths.stagingDir, { recursive: true, force: true });
  fs.rmSync(paths.workDir, { recursive: true, force: true });
  fs.rmSync(paths.fixtureConfig, { recursive: true, force: true });
  fs.mkdirSync(paths.stagingDir, { recursive: true });
  fs.mkdirSync(paths.workDir, { recursive: true });
  let replaced = false;
  try {
    runNode(path.join(root, 'src', 'build-session-xlsx.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'build-dashboard-renderer.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'build-dashboard-css.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'build-cli-resources.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'build-app-resources.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'build-npm-package.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'prepare-extension.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'src', 'cli.js'), selfTestArguments(paths), {
      env: {
        ...releaseEnv,
        CODEARTS_BAR_DB: paths.fixtureDb,
        CODEARTS_BAR_CONFIG_DIR: paths.fixtureConfig,
        CODEARTS_BAR_DISABLE_USAGE_LOGS: '1',
        HOME: path.join(paths.workDir, 'home'),
        USERPROFILE: path.join(paths.workDir, 'home'),
        APPDATA: path.join(paths.workDir, 'home', 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(paths.workDir, 'home', 'AppData', 'Local'),
      },
    });

    fs.rmSync(jetbrainsArtifact, { force: true });
    const jetbrainsTasks = process.env.CODEARTS_BAR_SKIP_JETBRAINS_VERIFY === '1'
      ? ['--offline', '--no-daemon', '--no-configuration-cache', 'clean', 'test', 'buildPlugin']
      : ['clean', 'test', 'verifyPlugin', 'buildPlugin'];
    runNode(path.join(root, 'src', 'run-jetbrains-gradle.js'), jetbrainsTasks, { env: releaseEnv });
    runNode(path.join(root, 'tests', 'quality-jetbrains.js'), [], { env: releaseEnv });
    copyRequired(jetbrainsArtifact, path.join(paths.stagingDir, jetbrainsName));

    runNode(path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), ['package', '--out', path.join(paths.stagingDir, 'codearts-bar-status.vsix')], { cwd: extensionStaging, env: releaseEnv });

    fs.mkdirSync(paths.distDir, { recursive: true });
    const runtimeBuilderConfig = require(path.join(root, 'electron-builder.runtime.js'));
    fs.writeFileSync(builderConfig, JSON.stringify({
      ...runtimeBuilderConfig,
      directories: { ...(runtimeBuilderConfig.directories || {}), output: paths.distDir },
    }, null, 2), 'utf8');
    runNode(path.join(root, 'node_modules', 'electron-builder', 'cli.js'), [
      '--projectDir', path.join(root, '.cache', 'app-runtime'),
      '--config', builderConfig,
      '--win', 'nsis', 'portable', '--x64', '--publish', 'never',
    ], { env: releaseEnv });
    for (const name of names.filter((name) => /^CodeArts-Bar-(?:Setup|Portable)-/i.test(name))) {
      copyRequired(path.join(paths.distDir, name), path.join(paths.stagingDir, name));
    }

    runNode(path.join(root, 'tests', 'app-asar-smoke.js'), [], { env: { ...releaseEnv, CODEARTS_BAR_DIST_DIR: paths.distDir } });
    runNode(path.join(root, 'tests', 'package-resource-smoke.js'), [], { env: { ...releaseEnv, CODEARTS_BAR_DIST_DIR: paths.distDir } });
    runNode(path.join(root, 'tests', 'release-package-smoke.js'), [], { env: { ...releaseEnv, CODEARTS_BAR_DIST_DIR: paths.distDir } });
    runNode(path.join(root, 'tests', 'extension-package-smoke.js'), [], {
      env: { ...releaseEnv, CODEARTS_BAR_VSIX: path.join(paths.stagingDir, 'codearts-bar-status.vsix') },
    });
    runNode(path.join(root, 'tests', 'jetbrains-plugin-smoke.js'), [], { env: releaseEnv });
    runNode(path.join(root, 'tests', 'npm-package-smoke.js'), [], { env: releaseEnv });

    if (process.platform !== 'win32' || !nodeSupportsNativeSqlite() || process.env.CODEARTS_BAR_BUNDLE_NODE === '0') {
      throw new Error('Standalone Windows CLI release requires a Windows Node.js runtime with node:sqlite');
    }
    const cliSmall = path.join(paths.workDir, 'codearts-bar-cli');
    const cliStandalone = path.join(paths.workDir, 'codearts-bar-cli-standalone');
    prepareCliPackage(cliSmall, cliRuntime);
    prepareCliPackage(cliStandalone, cliRuntime, { bundleNode: true });
    compressDirectoryContents(cliSmall, path.join(paths.stagingDir, 'codearts-bar-cli.zip'));
    compressDirectoryContents(cliStandalone, path.join(paths.stagingDir, 'codearts-bar-cli-standalone.zip'));
    runNode(path.join(root, 'tests', 'cli-release-smoke.js'), [], {
      env: {
        ...releaseEnv,
        CODEARTS_BAR_RELEASE_DIR: paths.stagingDir,
        CODEARTS_BAR_FIXTURE_DB: paths.fixtureDb,
        CODEARTS_BAR_FIXTURE_CONFIG_DIR: paths.fixtureConfig,
      },
    });

    runNode(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), [
      'pack', npmStaging, '--pack-destination', paths.stagingDir,
    ], { env: releaseEnv });

    validateArchiveEntries(path.join(paths.stagingDir, 'codearts-bar-cli.zip'), ['src/bin.js', 'CLI_RUNTIME_MANIFEST.json']);
    validateArchiveEntries(path.join(paths.stagingDir, 'codearts-bar-cli-standalone.zip'), ['node.exe', 'src/bin.js', 'CLI_RUNTIME_MANIFEST.json']);
    validateArchiveEntries(path.join(paths.stagingDir, 'codearts-bar-status.vsix'), ['extension/package.json', 'extension/extension.js']);
    validateArchiveEntries(path.join(paths.stagingDir, jetbrainsName), [`codearts-bar-jetbrains/lib/codearts-bar-jetbrains-${pkg.version}.jar`]);
    validateArchiveEntries(path.join(paths.stagingDir, `codearts-bar-${pkg.version}.tgz`), ['package/package.json', 'package/src/bin.js']);

    writeReleaseManifest({ releaseDir: paths.stagingDir, version: pkg.version, artifactNames: names, env: releaseEnv });
    verifyReleaseManifest({ releaseDir: paths.stagingDir, version: pkg.version, artifactNames: names });
    atomicReplaceReleaseDir(paths.stagingDir, paths.releaseDir);
    replaced = true;
    console.log(`Release ${pkg.version} verified and published locally to ${paths.releaseDir}`);
    return { ...paths, artifactNames: names };
  } finally {
    fs.rmSync(paths.workDir, { recursive: true, force: true });
    fs.rmSync(paths.fixtureConfig, { recursive: true, force: true });
    if (!replaced && process.env.CODEARTS_BAR_KEEP_RELEASE_STAGING !== '1') fs.rmSync(paths.stagingDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { buildRelease(); }
  catch (error) {
    console.error(`Release failed; existing release directory was preserved: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  FIXTURE_NOW_MS,
  artifactNames,
  buildRelease,
  copyRequired,
  releasePaths,
  sanitizedReleaseEnv,
  selfTestArguments,
  sourceDateEpoch,
  validateArchiveEntries,
  validateRequired,
};
