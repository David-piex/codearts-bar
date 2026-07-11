'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const projectDir = path.join(root, 'jetbrains-plugin');
const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const wrapper = path.join(projectDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (!fs.existsSync(wrapper)) throw new Error(`Missing Gradle wrapper: ${wrapper}`);
const gradleArgs = process.argv.slice(2).length ? process.argv.slice(2) : ['buildPlugin'];
let result;
if (process.platform === 'win32') {
  const quote = (value) => /[\s"]/u.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const command = [wrapperName, ...gradleArgs.map(quote)].join(' ');
  result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], { cwd: projectDir, stdio: 'inherit' });
} else {
  result = spawnSync(wrapperName, gradleArgs, { cwd: projectDir, stdio: 'inherit' });
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
