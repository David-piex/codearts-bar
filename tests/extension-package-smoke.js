"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const extensionDir = path.join(root, "extension");
const extensionPkg = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf8").replace(/^\uFEFF/, ""));
const providerDir = path.join(root, "src", "providers", "codearts");
const requiredProviderFiles = fs.readdirSync(providerDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => `providers/codearts/${name}`)
  .sort();

for (const file of requiredProviderFiles) {
  assert.ok(extensionPkg.files.includes(file), `extension files whitelist should include ${file}`);
  assert.ok(fs.existsSync(path.join(extensionDir, file)), `prepared extension should contain ${file}`);
}

const vsix = path.join(root, "release", "codearts-bar-status.vsix");
if (fs.existsSync(vsix)) {
  const entries = execFileSync("tar.exe", ["-tf", vsix], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  for (const file of requiredProviderFiles) {
    assert.ok(entries.includes(`extension/${file}`), `VSIX should contain extension/${file}`);
  }
}

console.log(`ok - extension package smoke providers=${requiredProviderFiles.length}`);
