"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeReleaseManifest } = require("../src/release-manifest");

function hash(text) {
  return crypto.createHash("sha256").update(Buffer.from(text)).digest("hex");
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-release-manifest-"));

try {
  const files = {
    "CodeArts-Bar-Setup-9.9.9-x64.exe": "installer-fixture",
    "CodeArts-Bar-Portable-9.9.9-x64.exe": "portable-fixture",
    "codearts-bar-cli.zip": "cli-fixture",
    "codearts-bar-status.vsix": "vsix-fixture",
    "codearts-bar-jetbrains-9.9.9.zip": "jetbrains-fixture",
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmpDir, name), content);
  }

  const latest = writeReleaseManifest({
    releaseDir: tmpDir,
    version: "9.9.9",
    generatedAt: "2026-07-09T00:00:00.000Z",
    artifactNames: [...Object.keys(files), "missing-artifact.exe"],
  });

  assert.equal(latest.version, "9.9.9");
  assert.equal(latest.generatedAt, "2026-07-09T00:00:00.000Z");
  assert.equal(latest.artifacts.length, 5);
  assert.deepEqual(latest.artifacts.map((item) => item.name), Object.keys(files).sort((a, b) => a.localeCompare(b)));

  const latestJson = JSON.parse(fs.readFileSync(path.join(tmpDir, "latest.json"), "utf8"));
  assert.equal(latestJson.artifacts[0].sha256, hash(files[latestJson.artifacts[0].name]));
  assert.equal(latestJson.artifacts.some((item) => item.name === "missing-artifact.exe"), false);

  const sums = fs.readFileSync(path.join(tmpDir, "SHA256SUMS.txt"), "utf8");
  assert.match(sums, new RegExp(`${hash("cli-fixture")}  codearts-bar-cli\\.zip`));
  assert.doesNotMatch(sums, /missing-artifact/);

  const notes = fs.readFileSync(path.join(tmpDir, "RELEASE_NOTES.md"), "utf8");
  assert.match(notes, /CodeArts Bar 9\.9\.9/);
  assert.match(notes, /开源版发布说明/);
  assert.match(notes, /SHA256SUMS\.txt/);
  assert.match(notes, /codearts-bar-status\.vsix/);
  assert.match(notes, /codearts-bar-jetbrains-9\.9\.9\.zip/);

  console.log("ok - release manifest smoke");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
