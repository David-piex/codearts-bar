const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeReleaseManifest } = require('./release-manifest');
const { cleanManagedReleaseDir } = require('./release-artifacts');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
fs.mkdirSync(releaseDir, { recursive: true });
const removedReleaseArtifacts = cleanManagedReleaseDir(releaseDir);
if (removedReleaseArtifacts.length) console.log(`Cleaned ${removedReleaseArtifacts.length} managed release artifacts`);

function runNode(script, args, opts = {}) {
  console.log(`> node ${script} ${args.map((a) => String(a).includes(' ') ? JSON.stringify(a) : a).join(' ')}`);
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit', cwd: opts.cwd || root, shell: false });
}
function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.map((a) => String(a).includes(' ') ? JSON.stringify(a) : a).join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || root, shell: false });
}
function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}
function writeText(file, text, encoding = 'utf8') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, encoding);
}
function nodeSupportsNativeSqlite() {
  try { return Boolean(require('node:sqlite').DatabaseSync); }
  catch { return false; }
}

runNode(path.join(root, 'src', 'build-dashboard-renderer.js'), []);
runNode(path.join(root, 'src', 'build-dashboard-css.js'), []);
runNode(path.join(root, 'src', 'build-cli-resources.js'), []);
runNode(path.join(root, 'src', 'build-app-resources.js'), []);
runNode(path.join(root, 'src', 'build-npm-package.js'), []);
runNode(path.join(root, 'src', 'prepare-extension.js'), []);
runNode(path.join(root, 'src', 'cli.js'), ['self-test']);
runNode(path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), ['package', '--out', path.join(releaseDir, 'codearts-bar-status.vsix')], { cwd: path.join(root, 'extension') });
runNode(path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ['--projectDir', path.join(root, '.cache', 'app-runtime'), '--config', path.join(root, 'electron-builder.runtime.js'), '--win', 'nsis', 'portable', '--x64', '--publish', 'never']);
runNode(path.join(root, 'tests', 'package-resource-smoke.js'), []);
runNode(path.join(root, 'tests', 'release-package-smoke.js'), []);

const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
  for (const file of fs.readdirSync(distDir)) {
    const isCurrentArtifact = file === `CodeArts-Bar-Setup-${pkg.version}-x64.exe` || file === `CodeArts-Bar-Portable-${pkg.version}-x64.exe`;
    const isMetadata = file.includes(pkg.version) && (/\.yml$|\.blockmap$/i.test(file));
    if (isCurrentArtifact || isMetadata) copyIfExists(path.join(distDir, file), path.join(releaseDir, file));
  }
}

const cliPkg = path.join(releaseDir, 'codearts-bar-cli');
const cliStandalonePkg = path.join(releaseDir, 'codearts-bar-cli-standalone');
const cliRuntime = path.join(root, '.cache', 'cli-runtime');
function prepareCliPackage(target, { bundleNode = false } = {}) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(cliRuntime, target, { recursive: true });
  for (const file of ['README.md', 'LICENSE']) copyIfExists(path.join(root, file), path.join(target, file));
  writeText(path.join(target, 'codearts-bar.cmd'), '@echo off\r\nsetlocal\r\nset "APPDIR=%~dp0"\r\nset "NODE=%APPDIR%node.exe"\r\nif exist "%NODE%" (\r\n  "%NODE%" "%APPDIR%src\\bin.js" %*\r\n) else (\r\n  node "%APPDIR%src\\bin.js" %*\r\n)\r\nexit /b %ERRORLEVEL%\r\n', 'ascii');
  writeText(path.join(target, 'codearts-bar.ps1'), `$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $appDir 'node.exe'
$cli = Join-Path $appDir 'src\bin.js'
if (Test-Path -LiteralPath $node) { & $node $cli @args } else { & node $cli @args }
exit $LASTEXITCODE
`);
  writeText(path.join(target, 'CLI_RUNTIME.md'), bundleNode
    ? '# CodeArts Bar CLI Standalone\n\nIncludes a private Node.js runtime. Run codearts-bar.cmd or codearts-bar.ps1.\n'
    : '# CodeArts Bar CLI\n\nRequires Node.js 18 or newer. Run codearts-bar.cmd or codearts-bar.ps1.\n');
  if (bundleNode) copyIfExists(process.execPath, path.join(target, 'node.exe'));
}
prepareCliPackage(cliPkg);
prepareCliPackage(cliStandalonePkg, { bundleNode: process.platform === 'win32' && nodeSupportsNativeSqlite() && process.env.CODEARTS_BAR_BUNDLE_NODE !== '0' });
function compressDirectoryContents(sourceDir, destination) {
  const sourceGlob = path.join(sourceDir, '*');
  run('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${sourceGlob}' -DestinationPath '${destination}' -Force`]);
}
compressDirectoryContents(cliPkg, path.join(releaseDir, 'codearts-bar-cli.zip'));
compressDirectoryContents(cliStandalonePkg, path.join(releaseDir, 'codearts-bar-cli-standalone.zip'));
runNode(path.join(root, 'tests', 'cli-release-smoke.js'), []);
runNode(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ['pack', path.join(root, '.cache', 'npm-package'), '--pack-destination', releaseDir]);

writeReleaseManifest({
  releaseDir,
  version: pkg.version,
  artifactNames: [`CodeArts-Bar-Setup-${pkg.version}-x64.exe`, `CodeArts-Bar-Portable-${pkg.version}-x64.exe`, 'codearts-bar-cli.zip', 'codearts-bar-cli-standalone.zip', `codearts-bar-${pkg.version}.tgz`, 'codearts-bar-status.vsix'],
});
console.log(`Release artifacts in ${releaseDir}`);
