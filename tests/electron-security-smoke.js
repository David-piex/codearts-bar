"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");
const windowSource = fs.readFileSync(path.join(root, "main", "window.js"), "utf8");
const dashboardPreload = fs.readFileSync(path.join(root, "dashboard-preload.js"), "utf8");
const settingsPreload = fs.readFileSync(path.join(root, "settings-preload.js"), "utf8");
const dashboardEntry = fs.readFileSync(path.join(root, "dashboard", "renderer-entry.js"), "utf8");
const settingsRenderer = fs.readFileSync(path.join(root, "settings-renderer.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
const releaseSource = fs.readFileSync(path.join(root, "release.js"), "utf8");

assert.doesNotMatch(windowSource, /nodeIntegration:\s*true/);
assert.doesNotMatch(windowSource, /contextIsolation:\s*false/);
assert.equal((windowSource.match(/nodeIntegration:\s*false/g) || []).length, 2);
assert.equal((windowSource.match(/contextIsolation:\s*true/g) || []).length, 2);
assert.equal((windowSource.match(/sandbox:\s*true/g) || []).length, 2);
assert.match(windowSource, /dashboard-preload\.js/);
assert.match(windowSource, /settings-preload\.js/);
assert.match(windowSource, /setWindowOpenHandler/);
assert.match(windowSource, /will-navigate/);
assert.match(dashboardPreload, /contextBridge\.exposeInMainWorld/);
assert.match(dashboardPreload, /platform:\s*process\.platform/);
assert.match(dashboardPreload, /dashboard:refreshLight/);
assert.match(dashboardPreload, /dashboard:refreshFull/);
assert.match(dashboardPreload, /dashboard:setRefreshInterval/);
assert.match(dashboardPreload, /dashboard:rollupState/);
assert.match(settingsPreload, /contextBridge\.exposeInMainWorld/);
assert.doesNotMatch(dashboardEntry, /require\(['"]electron['"]\)/);
assert.doesNotMatch(settingsRenderer, /require\(['"]electron['"]\)/);
assert.match(dashboardEntry, /window\.codeartsApi/);
assert.match(settingsRenderer, /window\.codeartsApi/);
assert.match(mainSource, /closeSqlJsWorker/);
assert.match(mainSource, /disableHardwareAcceleration\(\)/);
assert.match(mainSource, /crashReporter: electronCrashReporter/);
assert.match(mainSource, /clearDisposableRendererCaches/);
assert.match(windowSource, /rendererRecoveryCount\s*<\s*1/);
assert.match(windowSource, /renderer-recovery-recreate/);
assert.doesNotMatch(windowSource, /reloadIgnoringCache\(\)/);
assert.match(releaseSource, /build-dashboard-css\.js/);

console.log("ok - electron security smoke");
