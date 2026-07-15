'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, '.cache', 'app-runtime');
const required = new Set();

function readUtf8(file) { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
function reproducibleTimestamp() {
  if (process.env.SOURCE_DATE_EPOCH == null || process.env.SOURCE_DATE_EPOCH === '') return null;
  const seconds = Number(process.env.SOURCE_DATE_EPOCH);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer');
  return new Date(Math.trunc(seconds) * 1000).toISOString();
}
function resolveLocalRequire(fromFile, spec) {
  if (!spec || !spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js'), path.join(base, 'index.json')]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  throw new Error(`Cannot resolve local require ${spec} from ${path.relative(root, fromFile)}`);
}
function scan(file) {
  const resolved = path.resolve(file);
  if (resolved.includes(`${path.sep}node_modules${path.sep}sql.js${path.sep}dist${path.sep}`)) return;
  if (!resolved.startsWith(srcDir + path.sep)) throw new Error(`Refusing app runtime dependency outside src: ${resolved}`);
  if (required.has(resolved)) return;
  required.add(resolved);
  if (!/\.(js|json)$/i.test(resolved)) return;
  const source = readUtf8(resolved);
  const re = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source))) {
    const child = resolveLocalRequire(resolved, match[1]);
    if (child) scan(child);
  }
  const workerRe = /\bpath\.join\(\s*__dirname\s*,\s*['"]([^'"]+\.js)['"]\s*\)/g;
  while ((match = workerRe.exec(source))) {
    const workerFile = path.resolve(path.dirname(resolved), match[1]);
    if (fs.existsSync(workerFile)) scan(workerFile);
  }
  if (path.basename(resolved) === 'usage-rollup.js') {
    const workerPool = path.join(path.dirname(resolved), 'usage-rollup-worker-pool.js');
    if (fs.existsSync(workerPool)) scan(workerPool);
  }
}
function copy(file, relative = path.relative(root, file)) {
  const dest = path.join(outDir, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  scan(path.join(srcDir, 'main.js'));
  for (const file of [...required].sort()) copy(file);
  for (const name of ['dashboard.html', 'dashboard-preload.js', 'dashboard-renderer.js', 'dashboard-bundle.css', 'settings.html', 'settings-preload.js', 'settings-renderer.js']) copy(path.join(srcDir, name));
  for (const name of ['codearts-logo-source.png', 'codearts-logo.ico', 'codearts-logo.png', 'codearts-tray.png']) copy(path.join(root, 'assets', name), path.join('assets', name));
  // Keep sql.js as explicit application data instead of relying on electron-builder's
  // node_modules dependency discovery for this intentionally minimal staging tree.
  const sqlDir = path.join(outDir, 'src', 'vendor', 'sql.js');
  fs.mkdirSync(sqlDir, { recursive: true });
  for (const name of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', name), path.join(sqlDir, name));
  const pkg = JSON.parse(readUtf8(path.join(root, 'package.json')));
  const runtimePkg = { name: pkg.name, version: pkg.version, description: pkg.description, main: 'src/main.js', type: 'commonjs', author: pkg.author, license: pkg.license };
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(runtimePkg, null, 2), 'utf8');
  const manifest = [...required].map((file) => path.relative(root, file).replace(/\\/g, '/')).sort();
  const runtimeManifest = { files: manifest };
  const generatedAt = reproducibleTimestamp();
  if (generatedAt) runtimeManifest.generatedAt = generatedAt;
  fs.writeFileSync(path.join(outDir, 'APP_RUNTIME_MANIFEST.json'), JSON.stringify(runtimeManifest, null, 2), 'utf8');
  const total = [...fs.readdirSync(outDir)].length;
  console.log(`app runtime: ${manifest.length} source dependencies -> ${path.relative(root, outDir)} topEntries=${total}`);
}
if (require.main === module) build();
module.exports = { build, reproducibleTimestamp, resolveLocalRequire };
