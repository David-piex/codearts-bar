"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-electron-e2e-"));
fs.mkdirSync(path.join(tempDir, "home", "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(tempDir, "home", "AppData", "Local"), { recursive: true });
const fixtureDb = path.join(__dirname, "fixtures", "opencode-fixture.db");
const stdoutPath = path.join(tempDir, "electron.stdout.log");
const stderrPath = path.join(tempDir, "electron.stderr.log");
const stdoutFd = fs.openSync(stdoutPath, "w");
const stderrFd = fs.openSync(stderrPath, "w");
const result = spawnSync(electronPath, [runner], {
  cwd: path.join(__dirname, ".."),
  timeout: 30000,
  windowsHide: true,
  stdio: ["ignore", stdoutFd, stderrFd],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    CODEARTS_BAR_E2E: "1",
    CODEARTS_BAR_DB: fixtureDb,
    CODEARTS_BAR_CONFIG_DIR: path.join(tempDir, "config"),
    CODEARTS_BAR_NOW_MS: "1783598400000",
    CODEARTS_BAR_DISABLE_USAGE_LOGS: "1",
    HOME: path.join(tempDir, "home"),
    USERPROFILE: path.join(tempDir, "home"),
    APPDATA: path.join(tempDir, "home", "AppData", "Roaming"),
    LOCALAPPDATA: path.join(tempDir, "home", "AppData", "Local"),
  },
});
fs.closeSync(stdoutFd);
fs.closeSync(stderrFd);
const stdout = fs.readFileSync(stdoutPath, "utf8");
const stderr = fs.readFileSync(stderrPath, "utf8");
try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}

if (result.error && result.error.code === "ETIMEDOUT") {
  console.error("electron dashboard e2e timed out");
  process.exit(1);
}

if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
assert.equal(result.status, 0, `electron dashboard e2e exited with ${result.status}`);
