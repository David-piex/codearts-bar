"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const bin = path.join(root, "src", "bin.js");
const bytes = fs.readFileSync(bin);
assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "CLI shebang must not be preceded by a UTF-8 BOM");
assert.equal(bytes.subarray(0, 2).toString("ascii"), "#!", "CLI entry must start with a shebang");
const fixtureDb = path.join(root, "tests", "fixtures", "opencode-fixture.db");
const fixtureEnv = { ...process.env, CODEARTS_BAR_DB: fixtureDb, CODEARTS_BAR_CONFIG_DIR: path.join(os.tmpdir(), "codearts-bar-cli-smoke-config") };
const direct = spawnSync(process.execPath, [bin, "self-test"], { cwd: root, encoding: "utf8", timeout: 30000, env: fixtureEnv });
assert.equal(direct.status, 0, direct.stderr || direct.stdout);
assert.match(direct.stdout, /ok - has db path/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bin-pack-"));
try {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const packCommand = process.platform === "win32" ? process.execPath : "npm";
  const packArgs = process.platform === "win32" ? [npmCli, "pack", "--json", "--pack-destination", temp] : ["pack", "--json", "--pack-destination", temp];
  const packed = spawnSync(packCommand, packArgs, { cwd: root, encoding: "utf8", timeout: 120000, windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const info = JSON.parse(packed.stdout);
  const tarball = path.join(temp, info[0].filename);
  const unpacked = path.join(temp, "unpacked");
  fs.mkdirSync(unpacked);
  const tarCommand = process.platform === "win32" ? "tar.exe" : "tar";
  const extract = spawnSync(tarCommand, ["-xf", tarball, "-C", unpacked], { encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(extract.status, 0, extract.stderr || extract.stdout);
  const packedBin = path.join(unpacked, "package", "src", "bin.js");
  const packedBytes = fs.readFileSync(packedBin);
  assert.equal(packedBytes.subarray(0, 2).toString("ascii"), "#!");
  const packedRun = spawnSync(process.execPath, [packedBin, "self-test"], { cwd: path.join(unpacked, "package"), encoding: "utf8", timeout: 30000, env: fixtureEnv });
  assert.equal(packedRun.status, 0, packedRun.stderr || packedRun.stdout);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("ok - cli bin smoke");
