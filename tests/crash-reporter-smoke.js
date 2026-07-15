"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");

const { createCrashReporter, normalizeError } = require("../src/main/crash-reporter");
const { createLogger, DEFAULT_MAX_LOG_BYTES } = require("../src/main/logger");
const { decorateWithRuntimeDiagnostics } = require("../src/main/ipc-dashboard");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-crash-"));
const secretHome = path.join(tmpDir, "Alice Secret Workspace");
const secretPath = path.join(secretHome, "project", "private-request.json");
const apiToken = "sk-live-super-secret-token";
const bearerToken = "Bearer abc.def.private";
const requestPrompt = "DO_NOT_PERSIST_THIS_REQUEST";
const credentialUrl = "https://alice:correct-horse@example.com/api?access_token=url-secret";
const logs = [];
const app = new EventEmitter();
app.getPath = () => secretHome;
app.getVersion = () => "0.0.0-test";
const processRef = new EventEmitter();
processRef.pid = 4321;

(async () => {
  try {
    fs.mkdirSync(secretHome, { recursive: true });
    const reporter = createCrashReporter({
      app,
      appendLog: (level, scope, message, detail) => logs.push({ level, scope, message, detail }),
      now: () => Date.UTC(2026, 6, 9, 10, 0, 0),
      processRef,
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
    });

    const markerPath = path.join(secretHome, "codearts-bar-runtime.json");
    fs.writeFileSync(markerPath, JSON.stringify({
      app: "CodeArts Bar",
      version: "0.0.0-old",
      pid: 1234,
      startedAt: "2026-07-09T09:00:00.000Z",
      updatedAt: "2026-07-09T09:01:00.000Z",
      cleanExit: false,
    }), "utf8");

    let state = reporter.getCrashState();
    assert.equal(state.ok, false);
    assert.ok(state.issues.some((issue) => issue.code === "last_crash_detected"));

    const cleanMarker = reporter.markCleanExit();
    assert.equal(cleanMarker.version, "0.0.0-test");
    assert.equal(cleanMarker.pid, 4321);
    state = reporter.getCrashState();
    assert.equal(state.issues.some((issue) => issue.code === "last_crash_detected"), false);

    reporter.recordCrash("uncaughtException", new Error("main boom"), { scope: "unit" });
    state = reporter.getCrashState();
    assert.ok(state.issues.some((issue) => issue.code === "last_process_crash"));
    assert.ok(logs.some((entry) => entry.level === "fatal" && entry.scope === "crash:uncaughtException"));

    const typedError = new TypeError(`request failed token=${apiToken} ${bearerToken} at ${secretPath}`);
    typedError.code = "E_PRIVATE_REQUEST";
    typedError.stack = `TypeError: ${typedError.message}\n    at submit (${secretPath}:7:9)`;
    const crashDetail = {
      payload: {
        source: "desktop",
        limit: 20,
        range: { start: 1, endExclusive: 2 },
        prompt: requestPrompt,
        token: apiToken,
      },
      authorization: bearerToken,
      endpoint: credentialUrl,
    };
    crashDetail.self = crashDetail;
    const crashPayload = reporter.recordCrash("uncaughtException", typedError, crashDetail);
    assert.equal(crashPayload.error.name, "TypeError");
    assert.equal(crashPayload.error.code, "E_PRIVATE_REQUEST");
    assert.match(crashPayload.error.stack, /\[path\]:7:9/);

    const rendererError = { name: "RendererProtocolError", message: `renderer prompt="${requestPrompt}" password=hunter2`, stack: `at render (${secretPath}:3:4)`, code: "E_RENDER" };
    reporter.recordRendererError("window_error", rendererError, { filename: secretPath, body: requestPrompt, url: credentialUrl });
    reporter.install();
    state = reporter.getCrashState();
    assert.ok(state.issues.some((issue) => issue.code === "last_renderer_error"));
    assert.ok(logs.some((entry) => entry.level === "error" && entry.scope === "renderer:window_error"));

    const normalized = normalizeError(rendererError);
    assert.equal(normalized.name, "RendererProtocolError");
    assert.equal(normalized.code, "E_RENDER");
    assert.match(normalized.stack, /\[path\]:3:4/);

    for (const crashFile of [reporter.paths().processCrash, reporter.paths().rendererError]) {
      const contents = fs.readFileSync(crashFile, "utf8");
      const parsed = JSON.parse(contents);
      assert.ok(parsed.error.name);
      for (const forbidden of [secretHome, apiToken, bearerToken, requestPrompt, "hunter2", "correct-horse", "url-secret"]) {
        assert.equal(contents.includes(forbidden), false, `crash report leaked ${forbidden}`);
      }
    }
    const capturedLogs = JSON.stringify(logs);
    for (const forbidden of [secretHome, apiToken, bearerToken, requestPrompt, "hunter2", "correct-horse", "url-secret"]) {
      assert.equal(capturedLogs.includes(forbidden), false, `crash logger payload leaked ${forbidden}`);
    }

    reporter.clearRendererError();
    state = reporter.getCrashState();
    assert.equal(state.issues.some((issue) => issue.code === "last_renderer_error"), false);

    const decorated = decorateWithRuntimeDiagnostics({ ok: true, diagnostics: { issues: [] } }, state);
    assert.ok(decorated.runtimeDiagnostics);
    assert.ok(decorated.diagnostics.issues.some((issue) => issue.code === "last_process_crash"));

    assert.ok(DEFAULT_MAX_LOG_BYTES >= 2 * 1024 * 1024 && DEFAULT_MAX_LOG_BYTES <= 5 * 1024 * 1024);
    const opened = [];
    const maxBytes = 2048;
    fs.writeFileSync(path.join(secretHome, "codearts-bar.log.1"), "legacy".repeat(1000), "utf8");
    const logger = createLogger({
      app,
      shell: { openPath: async (file) => { opened.push(file); return ""; } },
      maxBytes,
    });
    const circular = { apiSecret: apiToken, payload: { source: "cli", query: requestPrompt, offset: 2 } };
    circular.self = circular;
    const writes = [];
    for (let index = 0; index < 80; index += 1) {
      writes.push(logger.appendLog(
        "error",
        "privacy-test",
        `TypeError ${index}: Authorization=${bearerToken} endpoint=${credentialUrl} path=${secretPath}`,
        { error: typedError, detail: circular, filler: "x".repeat(120) },
      ));
    }
    await Promise.all(writes);
    await logger.openLogFile();
    assert.deepEqual(opened, [logger.logPath()]);
    assert.equal(fs.existsSync(logger.logPath()), true);
    assert.equal(fs.existsSync(logger.rotatedLogPath()), true);

    const logFiles = [logger.logPath(), logger.rotatedLogPath()];
    for (const logFile of logFiles) {
      const stat = fs.statSync(logFile);
      assert.ok(stat.size <= maxBytes, `${path.basename(logFile)} exceeded the configured limit`);
      const contents = fs.readFileSync(logFile, "utf8");
      for (const line of contents.trim().split(/\r?\n/)) {
        const parsed = JSON.parse(line);
        assert.equal(parsed.level, "error");
        assert.equal(parsed.scope, "privacy-test");
        assert.match(parsed.message, /TypeError/);
      }
      for (const forbidden of [secretHome, apiToken, bearerToken, requestPrompt, "correct-horse", "url-secret"]) {
        assert.equal(contents.includes(forbidden), false, `log file leaked ${forbidden}`);
      }
    }
    const loggerSource = fs.readFileSync(path.join(__dirname, "..", "src", "main", "logger.js"), "utf8");
    assert.doesNotMatch(loggerSource, /appendFileSync/);

    console.log("ok - crash reporter and logger privacy smoke");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
