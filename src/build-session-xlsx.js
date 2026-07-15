'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'src', 'vendor', 'session-xlsx.js');

function build() {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  esbuild.buildSync({
    stdin: {
      contents: "module.exports = require('exceljs');",
      resolveDir: root,
      sourcefile: 'session-xlsx-entry.js',
      loader: 'js',
    },
    outfile: outFile,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: true,
    legalComments: 'inline',
    sourcemap: false,
  });
  console.log(`session xlsx runtime: ${path.relative(root, outFile)} ${(fs.statSync(outFile).size / 1024).toFixed(1)}KB`);
  return outFile;
}

if (require.main === module) build();
module.exports = { build };
