"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const mainSource = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
const windowSource = fs.readFileSync(path.join(root, "src", "main", "window.js"), "utf8");
const runtimeBuild = require(path.join(root, "electron-builder.runtime.js"));

assert.equal(pkg.main, "src/main.js", "Electron package entry should be src/main.js");
assert.match(mainSource, /CODEARTS_BAR_PACKAGE_SMOKE/, "main process should expose package smoke startup hook");
assert.match(mainSource, /CODEARTS_BAR_SMOKE_USER_DATA/, "package smoke should support isolated userData");
assert.match(windowSource, /dashboard-ready/, "dashboard window should write package smoke ready event");
assert.match(windowSource, /userDataIsolated/, "package smoke result should prove isolated userData was used");

const extraResources = runtimeBuild.extraResources || [];
assert.ok(Array.isArray(extraResources), "runtime build extraResources should be an array");
assert.deepEqual(
  extraResources.map((item) => ({ from: String(item?.from || "").replace(/\\/g, "/"), to: String(item?.to || "").replace(/\\/g, "/") })),
  [{ from: "../cli-runtime", to: "cli" }],
  "runtime package should copy the generated minimal CLI runtime"
);
assert.deepEqual(runtimeBuild.files, ["**/*"], "runtime builder should package only the staging project");
assert.equal(runtimeBuild.npmRebuild, false, "runtime builder must not rebuild dependencies from the repository root");
assert.equal(runtimeBuild.win?.icon, "assets/codearts-logo.ico", "runtime builder should use the staged application icon");
assert.equal((pkg.build?.extraResources || []).some((item) => String(item?.from || "").replace(/\\/g, "/") === "node_modules/sql.js/dist"), false, "legacy package config must not copy full sql.js/dist");

const generatedCliDir = path.join(root, ".cache", "cli-runtime");
if (fs.existsSync(generatedCliDir)) {
  const manifestFile = path.join(generatedCliDir, "CLI_RUNTIME_MANIFEST.json");
  assert.equal(fs.existsSync(manifestFile), true, "generated CLI runtime should include a manifest");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.equal(manifest.entry, "src/cli.js", "generated CLI runtime manifest should point at cli.js");
  assert.ok((manifest.files || []).includes("src/cli.js"), "generated CLI runtime manifest should include cli.js");
  assert.equal((manifest.files || []).includes("src/main.js"), false, "generated CLI runtime manifest must not include Electron main process");
  assert.equal((manifest.files || []).includes("src/dashboard-renderer.js"), false, "generated CLI runtime manifest must not include dashboard renderer");
  for (const rel of manifest.files || []) {
    assert.equal(fs.existsSync(path.join(generatedCliDir, rel)), true, `manifest file should exist: ${rel}`);
  }
  assert.equal(fs.existsSync(path.join(generatedCliDir, "src", "cli.js")), true, "generated CLI runtime should contain cli.js");
  assert.equal(fs.existsSync(path.join(generatedCliDir, "src", "dashboard-renderer.js")), false, "generated CLI runtime must not contain dashboard renderer");
  assert.equal(fs.existsSync(path.join(generatedCliDir, "src", "dashboard.html")), false, "generated CLI runtime must not contain dashboard html");
  assert.equal(fs.existsSync(path.join(generatedCliDir, "src", "main.js")), false, "generated CLI runtime must not contain Electron main process");
  assert.equal(fs.existsSync(path.join(generatedCliDir, "node_modules", "sql.js", "dist", "sql-wasm.js")), true, "generated CLI runtime should include sql-wasm.js");
  assert.equal(fs.existsSync(path.join(generatedCliDir, "node_modules", "sql.js", "dist", "sql-wasm.wasm")), true, "generated CLI runtime should include sql-wasm.wasm");
}

const sqlResourceDir = path.join(root, "dist", "win-unpacked", "resources", "cli", "node_modules", "sql.js", "dist");
if (fs.existsSync(sqlResourceDir)) {
  const files = fs.readdirSync(sqlResourceDir).filter((name) => fs.statSync(path.join(sqlResourceDir, name)).isFile()).sort();
  assert.deepEqual(files, ["sql-wasm.js", "sql-wasm.wasm"], "packaged CLI sql.js runtime should only contain wasm runtime files");
}

const cliSrcDir = path.join(root, "dist", "win-unpacked", "resources", "cli", "src");
if (fs.existsSync(cliSrcDir)) {
  assert.equal(fs.existsSync(path.join(cliSrcDir, "cli.js")), true, "packaged CLI should contain cli.js");
  assert.equal(fs.existsSync(path.join(cliSrcDir, "dashboard-renderer.js")), false, "packaged CLI must not contain dashboard renderer");
  assert.equal(fs.existsSync(path.join(cliSrcDir, "dashboard.html")), false, "packaged CLI must not contain dashboard html");
  assert.equal(fs.existsSync(path.join(cliSrcDir, "main.js")), false, "packaged CLI must not contain Electron main process");
}

const cliLauncher = path.join(root, "dist", "win-unpacked", process.platform === "win32" ? "codearts-bar.cmd" : "codearts-bar");
if (process.platform === "win32" && fs.existsSync(cliLauncher)) {
  const result = spawnSync("cmd.exe", ["/d", "/c", "call", cliLauncher, "runtime"], {
    cwd: path.join(root, "dist", "win-unpacked"),
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  if (process.env.CODEARTS_BAR_VERBOSE_PACKAGE_SMOKE === "1" && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr && !/ExperimentalWarning: SQLite/.test(result.stderr)) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `packaged CLI runtime exited with ${result.status}: ${result.error?.message || result.stderr || result.stdout}`);
  const runtime = JSON.parse(result.stdout);
  assert.equal(runtime.app, "CodeArts Bar CLI");
  assert.equal(runtime.execPath.endsWith("CodeArts Bar.exe"), true);
  assert.equal(runtime.sqlite?.fallback?.available, true);
  assert.match(String(runtime.sqlite?.fallback?.wasm || ""), /sql-wasm\.wasm$/);
  console.log(`ok - packaged CLI runtime node=${runtime.node} sqlite=${runtime.sqlite?.preferred || 'unknown'}`);
}

console.log("ok - package resource smoke");
