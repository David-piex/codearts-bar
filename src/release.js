const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeReleaseManifest } = require('./release-manifest');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
fs.mkdirSync(releaseDir, { recursive: true });

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
runNode(path.join(root, 'src', 'prepare-extension.js'), []);
runNode(path.join(root, 'src', 'cli.js'), ['self-test']);
runNode(path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), ['package', '--out', path.join(releaseDir, 'codearts-bar-status.vsix')], { cwd: path.join(root, 'extension') });
runNode(path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ['--win', 'nsis', 'portable', '--x64', '--publish', 'never']);
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
fs.rmSync(cliPkg, { recursive: true, force: true });
fs.mkdirSync(cliPkg, { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'README.md']) copyIfExists(path.join(root, file), path.join(cliPkg, file));
fs.cpSync(path.join(root, 'src'), path.join(cliPkg, 'src'), { recursive: true });
fs.cpSync(path.join(root, 'tests'), path.join(cliPkg, 'tests'), { recursive: true });
if (fs.existsSync(path.join(root, 'docs'))) fs.cpSync(path.join(root, 'docs'), path.join(cliPkg, 'docs'), { recursive: true });
const nmSql = path.join(cliPkg, 'node_modules', 'sql.js', 'dist');
fs.mkdirSync(nmSql, { recursive: true });
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) copyIfExists(path.join(root, 'node_modules', 'sql.js', 'dist', file), path.join(nmSql, file));
if (process.platform === 'win32' && nodeSupportsNativeSqlite() && process.env.CODEARTS_BAR_BUNDLE_NODE !== '0') {
  copyIfExists(process.execPath, path.join(cliPkg, 'node.exe'));
}
writeText(path.join(cliPkg, 'codearts-bar.cmd'), '@echo off\r\nsetlocal\r\nset "APPDIR=%~dp0"\r\nset "NODE=%APPDIR%node.exe"\r\nif exist "%NODE%" (\r\n  "%NODE%" "%APPDIR%src\\cli.js" %*\r\n) else (\r\n  node "%APPDIR%src\\cli.js" %*\r\n)\r\nexit /b %ERRORLEVEL%\r\n', 'ascii');
writeText(path.join(cliPkg, 'codearts-bar.ps1'), `$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $appDir 'node.exe'
$cli = Join-Path $appDir 'src\cli.js'
if (Test-Path -LiteralPath $node) {
  & $node $cli @args
} else {
  & node $cli @args
}
exit $LASTEXITCODE
`);
writeText(path.join(cliPkg, 'CLI_RUNTIME.md'), '# CodeArts Bar CLI Runtime\n\n- \u5b89\u88c5\u7248 CLI\uff1a\u901a\u8fc7\u5b89\u88c5\u76ee\u5f55\u7684 codearts-bar.cmd / codearts-bar.ps1 \u4f7f\u7528 Electron \u81ea\u5e26 Node\uff0c\u4e0d\u4f9d\u8d56\u7528\u6237\u673a\u5668 Node\u3002\n- \u72ec\u7acb CLI zip\uff1a\u4f18\u5148\u4f7f\u7528\u5305\u5185 node.exe\uff1b\u6ca1\u6709 node.exe \u65f6\u624d\u56de\u9000\u5230\u7cfb\u7edf node\u3002\n- SQLite\uff1a\u4f18\u5148 node:sqlite\uff1b\u5f53\u524d\u8fd0\u884c\u65f6\u4e0d\u652f\u6301\u65f6\u81ea\u52a8\u56de\u9000 sql.js + wasm\u3002\n- \u8bca\u65ad\uff1a\u8fd0\u884c codearts-bar.cmd runtime \u67e5\u770b\u5b9e\u9645 Node \u548c SQLite adapter\u3002\n');
run('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${cliPkg}\\*' -DestinationPath '${path.join(releaseDir, 'codearts-bar-cli.zip')}' -Force`]);

writeReleaseManifest({
  releaseDir,
  version: pkg.version,
  artifactNames: [`CodeArts-Bar-Setup-${pkg.version}-x64.exe`, `CodeArts-Bar-Portable-${pkg.version}-x64.exe`, 'codearts-bar-cli.zip', 'codearts-bar-status.vsix'],
});
console.log(`Release artifacts in ${releaseDir}`);
