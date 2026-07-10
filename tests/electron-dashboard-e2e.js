"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.env.CODEARTS_BAR_SKIP_ELECTRON_E2E === "1") {
  console.log("skip - electron dashboard e2e disabled by CODEARTS_BAR_SKIP_ELECTRON_E2E=1");
  process.exit(0);
}

let electronPath;
try {
  electronPath = require("electron");
} catch (error) {
  console.log(`skip - electron dashboard e2e requires electron: ${error.message}`);
  process.exit(0);
}

const runner = path.join(__dirname, "electron-dashboard-e2e-runner.js");
const result = spawnSync(electronPath, [runner], {
  cwd: path.join(__dirname, ".."),
  encoding: "utf8",
  timeout: 30000,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    CODEARTS_BAR_E2E: "1",
  },
});

if (result.error && result.error.code === "ETIMEDOUT") {
  console.error("electron dashboard e2e timed out");
  process.exit(1);
}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.equal(result.status, 0, `electron dashboard e2e exited with ${result.status}`);
