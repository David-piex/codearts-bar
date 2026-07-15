'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const projectDir = path.join(root, 'jetbrains-plugin');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version;
if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(String(packageVersion || ''))) {
  throw new Error(`Invalid package version for JetBrains build: ${packageVersion}`);
}
const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const wrapper = path.join(projectDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const requestedArgs = process.argv.slice(2).length ? process.argv.slice(2) : ['buildPlugin'];
const gradleArgs = requestedArgs.some((arg) => String(arg).startsWith('-PcodeartsBarVersion='))
  ? requestedArgs
  : [`-PcodeartsBarVersion=${packageVersion}`, ...requestedArgs];

function parseJavaMajor(version) {
  const match = String(version || '').trim().match(/^(?:1\.)?(\d+)/u);
  return match ? Number(match[1]) : 0;
}
function commandJavaMajor(executable, args, pattern, env = process.env) {
  try {
    const result = spawnSync(executable, args, { encoding: 'utf8', env, windowsHide: true, timeout: 5000 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(pattern);
    return result.status === 0 && match ? parseJavaMajor(match[1]) : 0;
  } catch {
    return 0;
  }
}
function javaMajorVersion(candidate) {
  if (!candidate) return 0;
  try {
    const release = fs.readFileSync(path.join(candidate, 'release'), 'utf8');
    const match = release.match(/^JAVA_VERSION=["']?([^"'\r\n]+)["']?$/mu);
    if (match) return parseJavaMajor(match[1]);
  } catch {}
  const javac = path.join(candidate, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  return commandJavaMajor(javac, ['-version'], /\bjavac\s+((?:1\.)?\d+(?:[^\s]*)?)/iu);
}
function usableJavaHome(candidate) {
  if (!candidate) return false;
  const java = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const javac = path.join(candidate, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  return fs.existsSync(java) && fs.existsSync(javac) && javaMajorVersion(candidate) >= 21;
}
function installedJetBrainsHomes(env = process.env) {
  if (process.platform !== 'win32') return [];
  const roots = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'JetBrains'),
    path.join(env.LOCALAPPDATA || '', 'Programs'),
    path.join(env.LOCALAPPDATA || '', 'JetBrains', 'Toolbox', 'apps'),
  ].filter(Boolean);
  const homes = [];
  const visit = (directory, depth) => {
    if (depth < 0 || !fs.existsSync(directory)) return;
    const jbr = path.join(directory, 'jbr');
    if (usableJavaHome(jbr)) homes.push(jbr);
    if (depth === 0) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name), depth - 1);
    }
  };
  for (const root of roots) visit(root, 4);
  return homes;
}
function discoverJavaHome(env = process.env, jetBrainsHomes = installedJetBrainsHomes(env)) {
  const candidates = [
    env.CODEARTS_BAR_JAVA_HOME,
    env.JAVA_HOME,
    env.IDEA_JDK,
    env.JDK_HOME,
    ...jetBrainsHomes,
  ].filter(Boolean);
  return candidates.find(usableJavaHome) || '';
}
function usableJavaOnPath(env = process.env) {
  const java = commandJavaMajor('java', ['-version'], /\bversion\s+["']?((?:1\.)?\d+(?:[^\s"']*)?)/iu, env);
  const javac = commandJavaMajor('javac', ['-version'], /\bjavac\s+((?:1\.)?\d+(?:[^\s]*)?)/iu, env);
  return java >= 21 && javac >= 21;
}
function main() {
  if (!fs.existsSync(wrapper)) throw new Error(`Missing Gradle wrapper: ${wrapper}`);
  const javaHome = discoverJavaHome();
  const usePathJava = !javaHome && usableJavaOnPath();
  if (!javaHome && !usePathJava) {
    throw new Error(
      'JetBrains plugin builds require a JDK or IntelliJ JBR with javac 21 or newer. '
      + 'Set CODEARTS_BAR_JAVA_HOME, or install IntelliJ IDEA 2024.2 or newer. '
      + 'Installing the finished plugin does not require a separate JDK.',
    );
  }
  const gradleEnv = { ...process.env };
  if (javaHome) {
    gradleEnv.JAVA_HOME = javaHome;
    const existingPath = gradleEnv.Path || gradleEnv.PATH || '';
    const updatedPath = `${path.join(javaHome, 'bin')}${path.delimiter}${existingPath}`;
    // Windows environment keys are case-insensitive; keep the canonical
    // `Path` spelling so Gradle Exec tasks can still resolve node.exe/cmd.exe.
    if (process.platform === 'win32') {
      delete gradleEnv.PATH;
      gradleEnv.Path = updatedPath;
    } else {
      gradleEnv.PATH = updatedPath;
    }
  } else {
    delete gradleEnv.JAVA_HOME;
  }
  let result;
  if (process.platform === 'win32') {
    const quote = (value) => /[\s"]/u.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
    const command = [wrapperName, ...gradleArgs.map(quote)].join(' ');
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    result = spawnSync(comspec, ['/d', '/s', '/c', command], { cwd: projectDir, stdio: 'inherit', env: gradleEnv });
  } else {
    result = spawnSync(wrapperName, gradleArgs, { cwd: projectDir, stdio: 'inherit', env: gradleEnv });
  }
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) main();

module.exports = {
  discoverJavaHome,
  installedJetBrainsHomes,
  javaMajorVersion,
  parseJavaMajor,
  usableJavaHome,
  usableJavaOnPath,
};
