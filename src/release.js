const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

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
function copyIfExists(src, dest) { if (fs.existsSync(src)) fs.copyFileSync(src, dest); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

runNode(path.join(root, 'src', 'prepare-extension.js'), []);
runNode(path.join(root, 'src', 'cli.js'), ['self-test']);
runNode(path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), ['package', '--out', path.join(releaseDir, 'codearts-bar-status.vsix')], { cwd: path.join(root, 'extension') });
runNode(path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ['--win', 'nsis', 'portable', '--x64']);

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
run('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${cliPkg}\\*' -DestinationPath '${path.join(releaseDir, 'codearts-bar-cli.zip')}' -Force`]);

const manifestArtifacts = [];
for (const name of [`CodeArts-Bar-Setup-${pkg.version}-x64.exe`, `CodeArts-Bar-Portable-${pkg.version}-x64.exe`, 'codearts-bar-cli.zip', 'codearts-bar-status.vsix']) {
  const file = path.join(releaseDir, name);
  if (fs.existsSync(file)) manifestArtifacts.push({ name, size: fs.statSync(file).size, sha256: sha256(file) });
}
fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify({ version: pkg.version, generatedAt: new Date().toISOString(), artifacts: manifestArtifacts }, null, 2));
console.log(`Release artifacts in ${releaseDir}`);
