"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const extensionDir = path.join(root, ".cache", "extension-staging");
const extensionPkg = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf8").replace(/^\uFEFF/, ""));
const providerDir = path.join(root, "src", "providers", "codearts");
assert.ok(extensionPkg.files.includes("extension-data.js"), "extension package should include staged data loader");
assert.ok(fs.existsSync(path.join(extensionDir, "extension-data.js")), "prepared extension should contain extension-data.js");
const requiredProviderFiles = fs.readdirSync(providerDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => `providers/codearts/${name}`)
  .sort();

for (const file of requiredProviderFiles) {
  assert.ok(extensionPkg.files.includes(file), `extension files whitelist should include ${file}`);
  const stagedFile = path.join(extensionDir, file);
  const sourceFile = path.join(root, 'src', file);
  assert.ok(fs.existsSync(stagedFile), `prepared extension should contain ${file}`);
  assert.equal(fs.readFileSync(stagedFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'), `prepared extension copy should match src/${file}`);
}

const sharedRuntimeFiles = [
  'codeartsData.js', 'officialStats.js', 'authStatus.js', 'settings.js',
  'quota.js', 'health.js', 'extension-data.js',
];
for (const file of sharedRuntimeFiles) {
  assert.equal(
    fs.readFileSync(path.join(extensionDir, file), 'utf8'),
    fs.readFileSync(path.join(root, 'src', file), 'utf8'),
    `prepared extension copy should match src/${file}`,
  );
}

const vsix = path.join(root, "release", "codearts-bar-status.vsix");
if (fs.existsSync(vsix)) {
  const entries = execFileSync("tar.exe", ["-tf", vsix], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  for (const file of requiredProviderFiles) {
    assert.ok(entries.includes(`extension/${file}`), `VSIX should contain extension/${file}`);
  }
}

console.log(`ok - extension package smoke providers=${requiredProviderFiles.length}`);
