const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'src', 'prepare-extension.js')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), 'package', '--out', path.join(releaseDir, 'codearts-bar-status.vsix')], { cwd: path.join(root, '.cache', 'extension-staging'), stdio: 'inherit' });
