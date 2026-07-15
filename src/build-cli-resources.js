'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const outDir = path.resolve(process.env.CODEARTS_BAR_CLI_RUNTIME_DIR || path.join(root, '.cache', 'cli-runtime'));
const configuredEntry = process.env.CODEARTS_BAR_CLI_ENTRY
  ? path.resolve(root, process.env.CODEARTS_BAR_CLI_ENTRY)
  : path.join(srcDir, 'bin.js');
const entry = configuredEntry;
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

function writeManifest(files, options = {}) {
  const sourceEntries = options.packagedFiles || files.map((file) => ({ rel: path.relative(root, file).replace(/\\/g, '/'), file }));
  const packagedFiles = [
    ...sourceEntries,
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
    entry: options.entry || path.relative(root, entry).replace(/\\/g, '/'),
    files: sourceEntries.map((item) => item.rel).sort(),
    hashes: Object.fromEntries(packagedFiles.map((item) => [
      item.rel,
      crypto.createHash('sha256').update(fs.readFileSync(item.file)).digest('hex'),
    ])),
  };
  fs.writeFileSync(path.join(outDir, 'CLI_RUNTIME_MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function prepareBundleEntry() {
  if (path.basename(entry).toLowerCase() !== 'jetbrains-cli.js') return { entry, cleanup() {} };
  required.clear();
  scan(entry);
  const stageRoot = path.join(outDir, '.bundle-src');
  for (const file of required) {
    const staged = path.join(stageRoot, path.relative(root, file));
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.copyFileSync(file, staged);
  }
  const slimDiagnostics = path.join(srcDir, 'providers', 'codearts', 'jetbrains-diagnostics.js');
  fs.copyFileSync(slimDiagnostics, path.join(stageRoot, 'src', 'providers', 'codearts', 'diagnostics.js'));
  const slimBestEffort = path.join(srcDir, 'core', 'jetbrains-best-effort.js');
  fs.copyFileSync(slimBestEffort, path.join(stageRoot, 'src', 'core', 'best-effort.js'));
  return {
    entry: path.join(stageRoot, path.relative(root, entry)),
    cleanup() { fs.rmSync(stageRoot, { recursive: true, force: true }); },
  };
}

function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let files;
  let manifestOptions = {};
  if (process.env.CODEARTS_BAR_CLI_BUNDLE === '1') {
    const relativeEntry = path.relative(root, entry).replace(/\\/g, '/');
    const jetbrainsEntry = path.basename(entry).toLowerCase() === 'jetbrains-cli.js';
    const bundleFile = path.join(outDir, ...relativeEntry.split('/'));
    fs.mkdirSync(path.dirname(bundleFile), { recursive: true });
    const bundleInput = prepareBundleEntry();
    try {
      require('esbuild').buildSync({
        entryPoints: [bundleInput.entry],
        outfile: bundleFile,
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        external: ['sql.js', ...(jetbrainsEntry ? ['../../protocol/query-results'] : [])],
        minify: true,
        charset: 'utf8',
        legalComments: 'none',
        sourcemap: false,
      });
    } finally {
      bundleInput.cleanup();
    }
    const packagedFiles = [{ rel: relativeEntry, file: bundleFile }];
    files = [bundleFile];
    if (jetbrainsEntry) {
      const protocolEntry = path.join(srcDir, 'protocol', 'query-results.js');
      const protocolRelative = path.relative(root, protocolEntry).replace(/\\/g, '/');
      const protocolTarget = path.join(outDir, ...protocolRelative.split('/'));
      fs.mkdirSync(path.dirname(protocolTarget), { recursive: true });
      require('esbuild').buildSync({
        entryPoints: [protocolEntry], outfile: protocolTarget, bundle: true, platform: 'node', target: 'node18',
        format: 'cjs', minify: true, charset: 'utf8', legalComments: 'none', sourcemap: false,
      });
      files.push(protocolTarget);
      packagedFiles.push({ rel: protocolRelative, file: protocolTarget });
      const exportEntry = path.join(srcDir, 'providers', 'codearts', 'session-export-cli.js');
      const exportRelative = path.relative(root, exportEntry).replace(/\\/g, '/');
      const exportBundle = path.join(outDir, ...exportRelative.split('/'));
      require('esbuild').buildSync({
        entryPoints: [exportEntry],
        outfile: exportBundle,
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        external: ['sql.js'],
        minify: true,
        charset: 'utf8',
        legalComments: 'none',
        sourcemap: false,
      });
      files.push(exportBundle);
      packagedFiles.push({ rel: exportRelative, file: exportBundle });
    }
    manifestOptions = { entry: relativeEntry, packagedFiles };
  } else {
    scan(entry);
    files = [...required].sort();
    for (const file of files) copyFilePreserveRoot(file);
  }
  copySqlRuntime();
  writeManifest(files, manifestOptions);
  const total = [...files, path.join(outDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'), path.join(outDir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')]
    .reduce((sum, file) => {
      try { return sum + fs.statSync(file).size; } catch { return sum; }
    }, 0);
  console.log(`cli runtime resources: ${files.length} source files -> ${path.relative(root, outDir)} (${(total / 1024).toFixed(1)}KB)`);
}

if (require.main === module) build();

module.exports = { build, resolveLocalRequire, prepareBundleEntry };
