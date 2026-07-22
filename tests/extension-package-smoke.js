"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const extensionDir = path.join(root, ".cache", "extension-staging");
const extensionPkg = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf8").replace(/^\uFEFF/, ""));
const providerDir = path.join(root, "src", "providers", "codearts");
const coreDir = path.join(root, "src", "core");
const protocolDir = path.join(root, "src", "protocol");
assert.ok(extensionPkg.files.includes('vendor/session-xlsx.js'), 'extension package should whitelist the XLSX runtime');
assert.ok(fs.existsSync(path.join(extensionDir, 'vendor', 'session-xlsx.js')), 'prepared extension should contain the XLSX runtime');
assert.ok(extensionPkg.files.includes('session-export.js'), 'extension package should whitelist the export privacy workflow');
assert.ok(fs.existsSync(path.join(extensionDir, 'session-export.js')), 'prepared extension should contain the export privacy workflow');
assert.equal(
  fs.readFileSync(path.join(extensionDir, 'session-export.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'extension', 'session-export.js'), 'utf8'),
  'prepared export privacy workflow should match the extension source',
);
assert.ok(extensionPkg.files.includes("extension-data.js"), "extension package should include staged data loader");
assert.ok(fs.existsSync(path.join(extensionDir, "extension-data.js")), "prepared extension should contain extension-data.js");
const requiredProviderFiles = fs.readdirSync(providerDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => `providers/codearts/${name}`)
  .sort();
const requiredCoreFiles = fs.readdirSync(coreDir)
  .filter((name) => name.endsWith(".js") && name !== "chart-axis.js")
  .map((name) => `core/${name}`)
  .sort();
const requiredProtocolFiles = fs.readdirSync(protocolDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => `protocol/${name}`)
  .sort();

for (const file of [...requiredCoreFiles, ...requiredProviderFiles, ...requiredProtocolFiles]) {
  assert.ok(extensionPkg.files.includes(file), `extension files whitelist should include ${file}`);
  const stagedFile = path.join(extensionDir, file);
  const sourceFile = path.join(root, 'src', file);
  assert.ok(fs.existsSync(stagedFile), `prepared extension should contain ${file}`);
  assert.equal(fs.readFileSync(stagedFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'), `prepared extension copy should match src/${file}`);
}

function resolveLocalRequire(packageRoot, fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const nodeModulesSuffix = request.split(/node_modules[\\/]/)[1];
  const packagedDependency = nodeModulesSuffix ? path.join(packageRoot, "node_modules", nodeModulesSuffix) : null;
  return [base, `${base}.js`, path.join(base, "index.js"), packagedDependency, packagedDependency && `${packagedDependency}.js`]
    .filter(Boolean)
    .find((candidate) => fs.existsSync(candidate));
}

function assertLocalRequiresPresent(packageRoot, files) {
  for (const relativeFile of files) {
    if (!relativeFile.endsWith(".js")) continue;
    const file = path.join(packageRoot, relativeFile);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
      assert.ok(resolveLocalRequire(packageRoot, file, match[1]), `${relativeFile} requires missing local module ${match[1]}`);
    }
  }
}

assertLocalRequiresPresent(extensionDir, extensionPkg.files);

const sharedRuntimeFiles = [
  'codeartsData.js', 'officialStats.js', 'authStatus.js', 'settings.js',
  'quota.js', 'health.js', 'extension-data.js', 'codearts-installation.js',
];
for (const file of sharedRuntimeFiles) {
  assert.equal(
    fs.readFileSync(path.join(extensionDir, file), 'utf8'),
    fs.readFileSync(path.join(root, 'src', file), 'utf8'),
    `prepared extension copy should match src/${file}`,
  );
}

const vsix = process.env.CODEARTS_BAR_VSIX ? path.resolve(process.env.CODEARTS_BAR_VSIX) : "";
if (vsix) {
  assert.ok(fs.existsSync(vsix), `VSIX smoke target does not exist: ${vsix}`);
  const entries = execFileSync("tar.exe", ["-tf", vsix], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  for (const file of [...requiredCoreFiles, ...requiredProviderFiles, ...requiredProtocolFiles]) {
    assert.ok(entries.includes(`extension/${file}`), `VSIX should contain extension/${file}`);
  }
  const unpackDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "codearts-vsix-smoke-"));
  try {
    execFileSync("tar.exe", ["-xf", vsix, "-C", unpackDir]);
    assertLocalRequiresPresent(path.join(unpackDir, "extension"), extensionPkg.files);
  } finally {
    fs.rmSync(unpackDir, { recursive: true, force: true });
  }
}

console.log(`ok - extension package smoke core=${requiredCoreFiles.length} providers=${requiredProviderFiles.length} protocol=${requiredProtocolFiles.length}`);
