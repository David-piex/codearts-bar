'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pluginRoot = path.join(root, 'jetbrains-plugin');
const required = [
  'build.gradle.kts', 'settings.gradle.kts', 'gradlew.bat',
  'src/main/resources/META-INF/plugin.xml',
  'src/main/java/com/codearts/bar/cli/CliProcessRunner.java',
  'src/main/java/com/codearts/bar/service/CodeArtsDataService.java',
  'src/main/java/com/codearts/bar/statusbar/CodeArtsStatusBarWidgetFactory.java',
  'src/main/java/com/codearts/bar/toolwindow/CodeArtsToolWindowFactory.java',
  'src/main/java/com/codearts/bar/toolwindow/CodeArtsDashboardPanel.java',
  'src/main/java/com/codearts/bar/toolwindow/TrendChartPanel.java',
  'src/main/java/com/codearts/bar/settings/CodeArtsConfigurable.java',
];
for (const file of required) assert.ok(fs.existsSync(path.join(pluginRoot, file)), `missing JetBrains plugin file: ${file}`);
const xml = fs.readFileSync(path.join(pluginRoot, 'src/main/resources/META-INF/plugin.xml'), 'utf8');
for (const marker of ['statusBarWidgetFactory', 'toolWindow', 'applicationConfigurable', 'CodeArtsBar.Refresh']) assert.ok(xml.includes(marker), `plugin.xml missing ${marker}`);
const distributions = path.join(pluginRoot, 'build', 'distributions');
assert.ok(fs.existsSync(distributions), 'JetBrains distribution directory missing; run build:jetbrains');
const zip = fs.readdirSync(distributions).find((name) => name.endsWith('.zip'));
assert.ok(zip, 'JetBrains plugin ZIP missing');
if (process.platform === 'win32') {
  const entries = execFileSync('tar.exe', ['-tf', path.join(distributions, zip)], { encoding: 'utf8' });
  assert.match(entries, /codearts-bar-jetbrains\/lib\/codearts-bar-jetbrains-[^/]+\.jar/);
  assert.match(entries, /codearts-bar-jetbrains\/lib\/codearts-bar-jetbrains-[^/]+\.jar/);
  const extractDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'codearts-jetbrains-zip-'));
  try {
    execFileSync('tar.exe', ['-xf', path.join(distributions, zip), '-C', extractDir]);
    const jarDir = path.join(extractDir, 'codearts-bar-jetbrains', 'lib');
    const jar = fs.readdirSync(jarDir).find((name) => /^codearts-bar-jetbrains-[^/]+\.jar$/.test(name) && !name.includes('searchableOptions'));
    const jarEntries = execFileSync('tar.exe', ['-tf', path.join(jarDir, jar)], { encoding: 'utf8' });
    assert.match(jarEntries, /cli\/src\/bin\.js/);
    assert.match(jarEntries, /cli\/node_modules\/sql\.js\/dist\/sql-wasm\.wasm/);
  } finally { fs.rmSync(extractDir, { recursive: true, force: true }); }
}
console.log(`ok - JetBrains plugin smoke ${zip}`);
