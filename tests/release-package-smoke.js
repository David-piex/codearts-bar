"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
// The standalone smoke command validates the atomically published release.
// Build orchestration can still point this test at its temporary dist folder.
const distDir = path.resolve(process.env.CODEARTS_BAR_DIST_DIR || path.join(root, "release"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

if (process.env.CODEARTS_BAR_SKIP_RELEASE_SMOKE === "1") {
  console.log("skip - release package smoke disabled by CODEARTS_BAR_SKIP_RELEASE_SMOKE=1");
  process.exit(0);
}

if (process.platform !== "win32") {
  console.log(`skip - release package smoke only runs on Windows, current=${process.platform}`);
  process.exit(0);
}

function findPortableArtifact() {
  const preferred = path.join(distDir, `CodeArts-Bar-Portable-${pkg.version}-x64.exe`);
  if (fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(distDir)) return null;
  const candidates = fs.readdirSync(distDir)
    .filter((name) => /^CodeArts-Bar-Portable-.*-x64\.exe$/i.test(name))
    .map((name) => {
      const file = path.join(distDir, name);
      const stat = fs.statSync(file);
      return { file, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file || null;
}

function findInstallerArtifact() {
  const preferred = path.join(distDir, `CodeArts-Bar-Setup-${pkg.version}-x64.exe`);
  if (fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(distDir)) return null;
  const candidates = fs.readdirSync(distDir)
    .filter((name) => /^CodeArts-Bar-Setup-.*-x64\.exe$/i.test(name))
    .map((name) => {
      const file = path.join(distDir, name);
      const stat = fs.statSync(file);
      return { file, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file || null;
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function waitForPackageReady({ child, resultFile, timeoutMs = 45000 }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let exit = null;
    const timer = setInterval(() => {
      const result = readJsonSafe(resultFile);
      if (result?.ok) {
        clearInterval(timer);
        resolve({ result, stdout, stderr, exit });
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        try { child.kill(); } catch {}
        reject(new Error(`release package smoke timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    }, 250);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      const result = readJsonSafe(resultFile);
      if (result?.ok) {
        clearInterval(timer);
        resolve({ result, stdout, stderr, exit });
      }
    });
    child.on("error", (error) => {
      clearInterval(timer);
      reject(error);
    });
  });
}

(async () => {
  const artifact = findPortableArtifact();
  assert.ok(artifact, `No portable package found in ${distDir}. Run npm run release first.`);
  const installer = findInstallerArtifact();
  assert.ok(installer, `No installer package found in ${distDir}. Run npm run release first.`);
  assert.match(path.basename(artifact), new RegExp(`^CodeArts-Bar-Portable-${pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-x64\\.exe$`), "portable artifact should match current package version");
  assert.match(path.basename(installer), new RegExp(`^CodeArts-Bar-Setup-${pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-x64\\.exe$`), "installer artifact should match current package version");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-release-smoke-"));
  const resultFile = path.join(tmpDir, "package-ready.json");
  const userData = path.join(tmpDir, "userData");
  const isolatedHome = path.join(tmpDir, "home");
  const fixtureDb = path.join(root, "tests", "fixtures", "opencode-fixture.db");
  const start = Date.now();
  let child = null;
  try {
    child = spawn(artifact, [], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
        CODEARTS_BAR_PACKAGE_SMOKE: "1",
        CODEARTS_BAR_PACKAGE_SMOKE_RESULT: resultFile,
        CODEARTS_BAR_SMOKE_USER_DATA: userData,
        CODEARTS_BAR_DB: fixtureDb,
        CODEARTS_BAR_CONFIG_DIR: path.join(tmpDir, "config"),
        CODEARTS_BAR_NOW_MS: process.env.CODEARTS_BAR_NOW_MS || "1783512000000",
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        APPDATA: path.join(isolatedHome, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(isolatedHome, "AppData", "Local"),
      },
    });
    const { result } = await waitForPackageReady({ child, resultFile });
    assert.equal(result.app, "CodeArts Bar");
    assert.equal(result.event, "dashboard-ready");
    assert.equal(result.version, pkg.version);
    assert.equal(result.userDataIsolated, true, "release package smoke must use isolated userData");
    assert.equal(result.userDataName, "userData", "release package smoke should not use the real userData directory");
    assert.equal(result.readyToShow || result.didFinishLoad, true);
    const elapsed = Date.now() - start;
    console.log(`ok - release package smoke artifact=${path.basename(artifact)} elapsed=${elapsed}ms appElapsed=${result.elapsedMs ?? "n/a"}ms`);
  } finally {
    if (child && !child.killed) {
      try { child.kill(); } catch {}
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
