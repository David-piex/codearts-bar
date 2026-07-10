"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");

const { createCrashReporter } = require("../src/main/crash-reporter");
const { decorateWithRuntimeDiagnostics } = require("../src/main/ipc-dashboard");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-crash-"));
const logs = [];
const app = new EventEmitter();
app.getPath = () => tmpDir;
app.getVersion = () => "0.0.0-test";

try {
  const reporter = createCrashReporter({
    app,
    appendLog: (level, scope, message, detail) => logs.push({ level, scope, message, detail }),
    now: () => Date.UTC(2026, 6, 9, 10, 0, 0),
    processRef: new EventEmitter(),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  const markerPath = path.join(tmpDir, "codearts-bar-runtime.json");
  fs.writeFileSync(markerPath, JSON.stringify({
    app: "CodeArts Bar",
    version: "0.0.0-test",
    pid: 1234,
    startedAt: "2026-07-09T09:00:00.000Z",
    updatedAt: "2026-07-09T09:01:00.000Z",
    cleanExit: false,
  }), "utf8");

  let state = reporter.getCrashState();
  assert.equal(state.ok, false);
  assert.ok(state.issues.some((issue) => issue.code === "last_crash_detected"));

  reporter.markCleanExit();
  state = reporter.getCrashState();
  assert.equal(state.issues.some((issue) => issue.code === "last_crash_detected"), false);

  reporter.recordCrash("uncaughtException", new Error("main boom"), { scope: "unit" });
  state = reporter.getCrashState();
  assert.ok(state.issues.some((issue) => issue.code === "last_process_crash"));
  assert.ok(logs.some((entry) => entry.level === "fatal" && entry.scope === "crash:uncaughtException"));

  reporter.recordRendererError("window_error", { message: "renderer boom", stack: "stack" }, { filename: "dashboard-renderer.js" });
  state = reporter.getCrashState();
  assert.ok(state.issues.some((issue) => issue.code === "last_renderer_error"));
  assert.ok(logs.some((entry) => entry.level === "error" && entry.scope === "renderer:window_error"));

  const decorated = decorateWithRuntimeDiagnostics({ ok: true, diagnostics: { issues: [] } }, state);
  assert.ok(decorated.runtimeDiagnostics);
  assert.ok(decorated.diagnostics.issues.some((issue) => issue.code === "last_process_crash"));

  console.log("ok - crash reporter smoke");
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
