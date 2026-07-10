'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { build: buildCliRuntime } = require('./build-cli-resources');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.cache', 'cli-runtime');
const outDir = path.join(root, '.cache', 'npm-package');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function build() {
  buildCliRuntime();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(runtime, 'src'), path.join(outDir, 'src'), { recursive: true });
  for (const name of ['README.md', 'LICENSE']) fs.copyFileSync(path.join(root, name), path.join(outDir, name));
  const pkg = readJson(path.join(root, 'package.json'));
  const publishPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: 'src/codeartsData.js',
    type: 'commonjs',
    bin: pkg.bin,
    keywords: pkg.keywords,
    author: pkg.author,
    license: pkg.license,
    repository: pkg.repository,
    dependencies: { 'sql.js': pkg.dependencies['sql.js'] },
    engines: { node: '>=18' },
  };
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(publishPkg, null, 2) + '\n', 'utf8');
  console.log(`npm package staging: ${path.relative(root, outDir)}`);
}
if (require.main === module) build();
module.exports = { build };
