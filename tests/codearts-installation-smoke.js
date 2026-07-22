'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  cleanExecutableValue,
  parseWindowsRegistryCandidates,
  windowsRegistryCandidates,
  parseMacApplicationCandidates,
  macSpotlightCandidates,
  findCodeArtsAgentInstallation,
} = require('../src/codearts-installation');

const registryOutput = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{fixture}_is1
    InstallLocation    REG_SZ    D:\\Developer Tools\\CodeArts Agent\\
    DisplayName    REG_SZ    CodeArts Agent
    DisplayIcon    REG_SZ    "D:\\Developer Tools\\CodeArts Agent\\codearts-agent.exe",0
`;

assert.equal(cleanExecutableValue('"D:\\Apps\\CodeArts Agent\\codearts-agent.exe",0'), 'D:\\Apps\\CodeArts Agent\\codearts-agent.exe');
assert.deepEqual(parseWindowsRegistryCandidates(registryOutput), [
  'D:\\Developer Tools\\CodeArts Agent\\codearts-agent.exe',
  'D:\\Developer Tools\\CodeArts Agent\\codearts-agent.exe',
]);
const registryQueries = [];
const queriedCandidates = windowsRegistryCandidates((command, args) => {
  registryQueries.push([command, ...args]);
  const relevant = args[1] === 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    && args.includes('/f') && args.includes('CodeArts Agent');
  return { status: relevant ? 0 : 1, stdout: relevant ? registryOutput : '' };
});
assert.ok(registryQueries.some((args) => args.includes('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')));
assert.ok(registryQueries.some((args) => args.includes('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')));
assert.ok(queriedCandidates.includes('D:\\Developer Tools\\CodeArts Agent\\codearts-agent.exe'));

const customExecutable = 'D:\\Developer Tools\\CodeArts Agent\\codearts-agent.exe';
const custom = findCodeArtsAgentInstallation({
  platform: 'win32',
  env: {},
  execPath: 'C:\\Program Files\\nodejs\\node.exe',
  argv: [],
  registryCandidates: [customExecutable],
  commandCandidates: [],
  isFile: (file) => file === customExecutable,
});
assert.deepEqual(custom, {
  executablePath: customExecutable,
  installDir: path.win32.dirname(customExecutable),
  source: 'registry',
});

const environmentExecutable = 'E:\\Portable\\codearts-agent.exe';
const environment = findCodeArtsAgentInstallation({
  platform: 'win32',
  env: { CODEARTS_AGENT_EXE: environmentExecutable },
  execPath: customExecutable,
  argv: [],
  registryCandidates: [customExecutable],
  commandCandidates: [],
  isFile: (file) => file === environmentExecutable || file === customExecutable,
});
assert.equal(environment.executablePath, environmentExecutable);
assert.equal(environment.source, 'environment');

const currentExecutable = 'F:\\Custom CodeArts\\codearts-agent.exe';
const current = findCodeArtsAgentInstallation({
  platform: 'win32',
  env: {},
  execPath: currentExecutable,
  argv: [],
  registryCandidates: [],
  commandCandidates: [],
  isFile: (file) => file === currentExecutable,
});
assert.equal(current.executablePath, currentExecutable);
assert.equal(current.source, 'current-process');

const missing = findCodeArtsAgentInstallation({
  platform: 'win32',
  env: {},
  execPath: '',
  argv: [],
  registryCandidates: [],
  commandCandidates: [],
  isFile: () => false,
});
assert.equal(missing, null);

const macBundle = '/Volumes/Developer Tools/Editors/CodeArts Agent.app';
const macExecutable = `${macBundle}/Contents/MacOS/codearts-agent`;
assert.deepEqual(parseMacApplicationCandidates(`${macBundle}\n${macExecutable}\n/Applications/Other.app/Contents/MacOS/other`), [
  macExecutable,
  macExecutable,
]);
const spotlightQueries = [];
assert.deepEqual(macSpotlightCandidates((command, args) => {
  spotlightQueries.push([command, ...args]);
  return { status: 0, stdout: `${macBundle}\n` };
}), [macExecutable]);
assert.deepEqual(spotlightQueries, [[
  'mdfind',
  'kMDItemCFBundleIdentifier == "com.huawei.codearts.agent"',
]]);
const mac = findCodeArtsAgentInstallation({
  platform: 'darwin',
  env: { HOME: '/Users/fixture' },
  execPath: '/usr/local/bin/node',
  argv: [],
  macApplicationCandidates: [macExecutable],
  commandCandidates: [],
  isFile: (file) => file === macExecutable,
});
assert.deepEqual(mac, {
  executablePath: macExecutable,
  installDir: `${macBundle}/Contents/MacOS`,
  source: 'spotlight',
});

for (const relative of ['src/main.js', 'src/diagnose.js', 'src/providers/codearts/logs.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  assert.match(source, /findCodeArtsAgentExecutable/);
  assert.doesNotMatch(source, /path\.join\(process\.env\.ProgramFiles[^\n]+codearts-agent\.exe/);
}

console.log('ok - CodeArts Agent installation auto-discovery');
