'use strict';
const electronVersion = require('./package.json').devDependencies.electron.match(/\d+\.\d+\.\d+/u)?.[0];
if (!electronVersion) throw new Error('package.json must declare an exact Electron-compatible semver range');

module.exports = {
  appId: 'local.codearts.bar',
  productName: 'CodeArts Bar',
  electronVersion,
  asar: true,
  npmRebuild: false,
  directories: { output: '../../dist' },
  files: ['**/*'],
  win: {
    icon: 'assets/codearts-logo.ico',
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'CodeArts Bar',
    artifactName: 'CodeArts-Bar-Setup-${version}-${arch}.${ext}',
  },
  portable: { artifactName: 'CodeArts-Bar-Portable-${version}-${arch}.${ext}' },
  extraFiles: [
    { from: '../../src/cli-launcher/codearts-bar.cmd', to: 'codearts-bar.cmd' },
    { from: '../../src/cli-launcher/codearts-bar.ps1', to: 'codearts-bar.ps1' },
  ],
  extraResources: [{ from: '../cli-runtime', to: 'cli' }],
};
