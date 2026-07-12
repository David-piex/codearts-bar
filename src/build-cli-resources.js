'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, '.cache', 'cli-runtime');
const entry = path.join(srcDir, 'bin.js');
const required = new Set();

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function resolveLocalRequire(fromFile, spec) {
  if (!spec || !spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    path.join(base, 'index.js'),
    path.join(base, 'index.json'),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return path.resolve(candidate);
    } catch {}
  }
  throw new Error(`Cannot resolve local require ${spec} from ${path.relative(root, fromFile)}`);
}

function scan(file) {
  const resolved = path.resolve(file);
  if (resolved.includes(`${path.sep}node_modules${path.sep}sql.js${path.sep}dist${path.sep}`)) return;
  if (!resolved.startsWith(srcDir + path.sep)) throw new Error(`Refusing to bundle outside src: ${resolved}`);
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
}

function copyFilePreserveRoot(file) {
  const rel = path.relative(root, file);
  const dest = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

function copySqlRuntime() {
  const destDir = path.join(outDir, 'node_modules', 'sql.js', 'dist');
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ['sql-wasm.js', 'sql-wasm.wasm']) {
    const src = path.join(root, 'node_modules', 'sql.js', 'dist', name);
    const dest = path.join(destDir, name);
    if (!fs.existsSync(src)) throw new Error(`Missing sql.js runtime file: ${src}`);
    fs.copyFileSync(src, dest);
  }
}

function writeManifest(files) {
  const packagedFiles = [
    ...files.map((file) => ({ rel: path.relative(root, file).replace(/\\/g, '/'), file })),
    ...['sql-wasm.js', 'sql-wasm.wasm'].map((name) => ({
      rel: `node_modules/sql.js/dist/${name}`,
      file: path.join(outDir, 'node_modules', 'sql.js', 'dist', name),
    })),
  ].sort((left, right) => left.rel.localeCompare(right.rel));
  const digest = crypto.createHash('sha256');
  for (const item of packagedFiles) {
    digest.update(item.rel, 'utf8');
    digest.update('\0');
    digest.update(fs.readFileSync(item.file));
    digest.update('\0');
  }
  const manifest = {
    contentHash: digest.digest('hex'),
    entry: 'src/bin.js',
    files: files.map((file) => path.relative(root, file).replace(/\\/g, '/')).sort(),
    hashes: Object.fromEntries(packagedFiles.map((item) => [
      item.rel,
      crypto.createHash('sha256').update(fs.readFileSync(item.file)).digest('hex'),
    ])),
  };
  fs.writeFileSync(path.join(outDir, 'CLI_RUNTIME_MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  scan(entry);
  const files = [...required].sort();
  for (const file of files) copyFilePreserveRoot(file);
  copySqlRuntime();
  writeManifest(files);
  const total = [...files, path.join(outDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'), path.join(outDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')]
    .reduce((sum, file) => {
      try { return sum + fs.statSync(file).size; } catch { return sum; }
    }, 0);
  console.log(`cli runtime resources: ${files.length} source files -> ${path.relative(root, outDir)} (${(total / 1024).toFixed(1)}KB)`);
}

if (require.main === module) build();

module.exports = { build, resolveLocalRequire };
