'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CACHE_HIT_TTL_MS = 60_000;
const CACHE_MISS_TTL_MS = 10_000;
let cached = { expiresAt: 0, value: null };

function cleanExecutableValue(value = '') {
  let text = String(value || '').trim();
  const quoted = text.match(/^"([^"]+)"/);
  if (quoted) text = quoted[1];
  else text = text.replace(/\s*,\s*-?\d+\s*$/, '').trim();
  return text;
}

function registryValues(block = '') {
  const values = {};
  for (const line of String(block || '').split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s{2,}(REG_[A-Z0-9_]+)\s{2,}(.*)$/i);
    if (match) values[match[1].trim().toLowerCase()] = match[3].trim();
  }
  return values;
}

function parseWindowsRegistryCandidates(output = '') {
  const candidates = [];
  for (const block of String(output || '').split(/(?=^HKEY_)/m)) {
    if (!/^HKEY_/m.test(block)) continue;
    const values = registryValues(block);
    const searchable = Object.values(values).join('\n');
    if (!/CodeArts Agent|codearts-agent\.exe/i.test(searchable)) continue;
    for (const name of ['displayicon', '(default)', '<no name>']) {
      const executable = cleanExecutableValue(values[name]);
      if (/codearts-agent\.exe$/i.test(executable)) candidates.push(executable);
    }
    for (const name of ['installlocation', 'inno setup: app path', 'path']) {
      const directory = cleanExecutableValue(values[name]);
      if (directory) candidates.push(path.win32.join(directory, 'codearts-agent.exe'));
    }
  }
  return candidates;
}

function run(command, args, spawn = spawnSync) {
  try {
    const result = spawn(command, args, {
      encoding: 'utf8',
      timeout: 4_000,
      windowsHide: true,
      shell: false,
    });
    return result?.status === 0 ? String(result.stdout || '') : '';
  } catch {
    return '';
  }
}

function windowsRegistryCandidates(spawn = spawnSync, isFile = null) {
  for (const root of [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]) {
    const candidates = parseWindowsRegistryCandidates(run('reg.exe', ['query', root, '/s', '/f', 'CodeArts Agent', '/d'], spawn));
    if (candidates.length && (!isFile || candidates.some(isFile))) return candidates;
  }
  for (const root of [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\codearts-agent.exe',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\codearts-agent.exe',
  ]) {
    const candidates = parseWindowsRegistryCandidates(run('reg.exe', ['query', root], spawn));
    if (candidates.length && (!isFile || candidates.some(isFile))) return candidates;
  }
  return [];
}

function commandPathCandidates(platform, spawn = spawnSync) {
  const command = platform === 'win32' ? 'where.exe' : 'which';
  const output = run(command, ['codearts-agent'], spawn);
  return output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function parseMacApplicationCandidates(output = '') {
  const candidates = [];
  for (const item of String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (/\.app\/?$/i.test(item)) candidates.push(path.posix.join(item.replace(/\/$/, ''), 'Contents', 'MacOS', 'codearts-agent'));
    else if (/\/Contents\/MacOS\/codearts-agent$/i.test(item)) candidates.push(item);
  }
  return candidates;
}

function macSpotlightCandidates(spawn = spawnSync) {
  const output = run('mdfind', ['kMDItemCFBundleIdentifier == "com.huawei.codearts.agent"'], spawn);
  return parseMacApplicationCandidates(output);
}

function candidateGroups(options = {}, isFile = null) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const addDirectory = (value) => value ? pathApi.join(String(value), platform === 'win32' ? 'codearts-agent.exe' : 'codearts-agent') : '';
  const directCandidates = [
    { path: env.CODEARTS_AGENT_EXE, source: 'environment' },
    { path: addDirectory(env.CODEARTS_AGENT_INSTALL_DIR || env.CODEARTS_AGENT_HOME), source: 'environment' },
  ];
  const expectedExecutableName = platform === 'win32' ? 'codearts-agent.exe' : 'codearts-agent';
  for (const executable of [options.execPath ?? process.execPath, ...(options.argv || process.argv || []), env.VSCODE_EXEC_PATH]) {
    if (pathApi.basename(String(executable || '')).toLowerCase() === expectedExecutableName) {
      directCandidates.push({ path: executable, source: 'current-process' });
    }
  }
  const platformCandidates = () => {
    if (platform === 'win32') {
      return (options.registryCandidates || windowsRegistryCandidates(options.spawnSync || spawnSync, isFile))
        .map((item) => ({ path: item, source: 'registry' }));
    }
    if (platform === 'darwin') {
      return (options.macApplicationCandidates || macSpotlightCandidates(options.spawnSync || spawnSync))
        .map((item) => ({ path: item, source: 'spotlight' }));
    }
    return [];
  };
  const pathCandidates = () => (options.commandCandidates || commandPathCandidates(platform, options.spawnSync || spawnSync))
    .map((item) => ({ path: item, source: 'path' }));
  const commonCandidates = [];
  if (platform === 'win32') {
    commonCandidates.push(
      { path: addDirectory(pathApi.join(env.ProgramFiles || 'C:\\Program Files', 'CodeArts Agent')), source: 'common-location' },
      { path: addDirectory(pathApi.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'CodeArts Agent')), source: 'common-location' },
      { path: env.LOCALAPPDATA ? addDirectory(pathApi.join(env.LOCALAPPDATA, 'Programs', 'CodeArts Agent')) : '', source: 'common-location' },
      { path: env.LOCALAPPDATA ? addDirectory(pathApi.join(env.LOCALAPPDATA, 'CodeArts Agent')) : '', source: 'common-location' },
    );
  } else if (platform === 'darwin') {
    commonCandidates.push(
      { path: '/Applications/CodeArts Agent.app/Contents/MacOS/codearts-agent', source: 'common-location' },
      { path: path.join(env.HOME || '', 'Applications', 'CodeArts Agent.app', 'Contents', 'MacOS', 'codearts-agent'), source: 'common-location' },
    );
  } else {
    commonCandidates.push(
      { path: '/opt/CodeArts Agent/codearts-agent', source: 'common-location' },
      { path: '/usr/local/bin/codearts-agent', source: 'common-location' },
      { path: '/usr/bin/codearts-agent', source: 'common-location' },
    );
  }
  return [directCandidates, platformCandidates, pathCandidates, commonCandidates];
}

function candidateList(options = {}) {
  return candidateGroups(options).flatMap((group) => typeof group === 'function' ? group() : group);
}

function defaultIsFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function findCodeArtsAgentInstallation(options = {}) {
  const cacheable = Object.keys(options).length === 0;
  const now = Date.now();
  if (cacheable && cached.expiresAt > now) {
    if (!cached.value || defaultIsFile(cached.value.executablePath)) return cached.value;
  }
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const isFile = options.isFile || defaultIsFile;
  const seen = new Set();
  let found = null;
  for (const group of candidateGroups(options, isFile)) {
    for (const candidate of typeof group === 'function' ? group() : group) {
      const executablePath = cleanExecutableValue(candidate.path);
      if (!executablePath) continue;
      const key = platform === 'win32' ? executablePath.toLowerCase() : executablePath;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isFile(executablePath)) continue;
      found = { executablePath, installDir: pathApi.dirname(executablePath), source: candidate.source };
      break;
    }
    if (found) break;
  }
  if (cacheable) cached = { expiresAt: now + (found ? CACHE_HIT_TTL_MS : CACHE_MISS_TTL_MS), value: found };
  return found;
}

function findCodeArtsAgentExecutable(options = {}) {
  return findCodeArtsAgentInstallation(options)?.executablePath || '';
}

function clearCodeArtsAgentInstallationCache() {
  cached = { expiresAt: 0, value: null };
}

module.exports = {
  candidateList,
  cleanExecutableValue,
  parseWindowsRegistryCandidates,
  windowsRegistryCandidates,
  parseMacApplicationCandidates,
  macSpotlightCandidates,
  findCodeArtsAgentInstallation,
  findCodeArtsAgentExecutable,
  clearCodeArtsAgentInstallationCache,
};
