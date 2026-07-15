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
if (!fs.existsSync(wrapper)) throw new Error(`Missing Gradle wrapper: ${wrapper}`);
const requestedArgs = process.argv.slice(2).length ? process.argv.slice(2) : ['buildPlugin'];
const gradleArgs = requestedArgs.some((arg) => String(arg).startsWith('-PcodeartsBarVersion='))
  ? requestedArgs
  : [`-PcodeartsBarVersion=${packageVersion}`, ...requestedArgs];
function usableJavaHome(candidate) {
  if (!candidate) return false;
  const java = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const javac = path.join(candidate, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  return fs.existsSync(java) && fs.existsSync(javac);
}
function discoverJavaHome() {
  const candidates = [
    process.env.CODEARTS_BAR_JAVA_HOME,
    'D:\\Develop\\JetBrains\\IntelliJ IDEA 2025.3.3\\jbr',
    'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.3.3\\jbr',
    process.env.JAVA_HOME,
    process.env.IDEA_JDK,
    process.env.JDK_HOME,
  ].filter(Boolean);
  return candidates.find(usableJavaHome) || '';
}
const javaHome = discoverJavaHome();
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
