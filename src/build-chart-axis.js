'use strict';

const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outfile = path.join(root, 'extension', 'media', 'scripts', 'chart-axis.js');

function buildChartAxisBrowser() {
  esbuild.buildSync({
    entryPoints: [path.join(root, 'src', 'core', 'chart-axis.js')],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'CodeArtsChartAxis',
    target: 'chrome120',
    legalComments: 'none',
    minify: true,
  });
  return outfile;
}

if (require.main === module) {
  buildChartAxisBrowser();
  console.log(`chart axis browser bundle: ${path.relative(root, outfile)}`);
}

module.exports = { buildChartAxisBrowser };
