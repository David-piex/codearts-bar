"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerDashboardIpc, buildDiagnosticsSummary } = require("../src/main/ipc-dashboard");

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-diagnostics-"));
process.env.USERPROFILE = tmpHome;
process.env.HOME = tmpHome;
process.env.APPDATA = path.join(tmpHome, "AppData", "Roaming");
delete process.env.CODEARTS_BAR_DB;

const { classifyDatabaseError, getDatabaseDiagnostics } = require("../src/providers/codearts/diagnostics");

function codes(report) {
  return new Set((report.issues || []).map((item) => item.code));
}

(async () => {
try {
  const missing = getDatabaseDiagnostics({ source: "all" });
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).has("codearts_not_installed"));
  assert.ok(codes(missing).has("database_missing"));
  assert.ok((missing.sources || []).some((source) => source.id === "desktop"));
  assert.ok((missing.sources || []).some((source) => source.id === "cli"));

  const emptyDb = path.join(tmpHome, "empty-opencode.db");
  fs.writeFileSync(emptyDb, "");
  const empty = getDatabaseDiagnostics({ dbPath: emptyDb });
  assert.equal(empty.ok, false);
  assert.ok(codes(empty).has("database_empty_file"));

  assert.equal(classifyDatabaseError("EACCES: permission denied", { id: "cli", label: "CLI" }).code, "database_permission");
  assert.equal(classifyDatabaseError("database disk image is malformed", { id: "cli", label: "CLI" }).code, "database_corrupt_or_schema");
  assert.equal(classifyDatabaseError("SQLITE_BUSY: database is locked", { id: "cli", label: "CLI" }).code, "database_locked");

  const fallback = getDatabaseDiagnostics({ timestamp: 123 }, { nativeError: "Cannot find module node:sqlite", sourceErrors: [] });
  assert.ok(codes(fallback).has("sqlite_fallback"));
  assert.equal(fallback.timestamp, 123);
  assert.doesNotMatch(JSON.stringify(missing), new RegExp(tmpHome.replace(/[\\^$.*+?()[\]{}|]/g, "\\\\$&")));

  const ipcMain = { handlers: {}, handle(name, fn) { this.handlers[name] = fn; } };
  registerDashboardIpc({
    ipcMain,
    app: { getVersion: () => "0.0.0-test", getPath: () => tmpHome },
    path,
    localProvider: {
      getDatabaseHealth: async () => ({ ok: false, items: [], sourceErrors: [], diagnostics: missing }),
      aggregateCacheStats: () => ({ hits: 1, misses: 2, reads: 3, hitRate: 1 / 3, size: 4, limit: 64 }),
      slowAggregateStats: () => ({
        count: 2,
        failed: 1,
        maxMs: 768.2,
        last: { label: "modelStats", adapter: "sql.js", ms: 512.4, failed: true, scope: "source=cli", timestamp: 1783386000000 },
        recent: [],
        byLabel: { modelStats: { count: 2, failed: 1, maxMs: 768.2, lastMs: 512.4 } },
        byAdapter: { "sql.js": { count: 2, failed: 1, maxMs: 768.2, lastMs: 512.4 } },
      }),
      usageRollupStats: () => ({
        enabled: true,
        buildEnabled: true,
        pendingCount: 1,
        compactHits: 2,
        tokenHits: 0,
        reads: 3,
        misses: 1,
        invalid: 0,
        hitRate: 2 / 3,
        lastBuildMs: 12,
        lastBuild: { status: "compact-hit" },
        buildFailed: 0,
        buildCompleted: 1,
      }),
      aggregateRollupState: () => ({
        status: "retrying", phase: "backoff", percent: 30, scannedRows: 30, totalRows: 100,
        attempt: 1, fallback: "direct-sql", nextRetryAt: Date.now() + 1000,
        error: `${tmpHome} should-not-leak`,
      }),
      listDataSources: () => [],
    },
    appendLog: () => {},
    logPath: () => path.join(tmpHome, "codearts-bar.log"),
    getCrashState: () => ({ issues: [{ code: "renderer_error", detail: "Authorization: Bearer should-not-leak" }] }),
    recordRendererError: () => {},
    getLastSnapshot: () => null,
    getLastDashboardSnapshot: () => null,
    buildInitialLightSnapshot: async () => ({ ok: true }),
    buildDashboardPreviewSnapshot: () => ({ ok: true }),
    buildDashboardLightSnapshot: async () => ({ ok: true }),
    refreshNow: async () => {},
    openSettingsWindow: () => {},
    setDashboardLayoutMode: () => {},
    setDashboardPinned: () => {},
    dashboardAggregatePayload: (payload) => payload,
    pageBounds: () => ({ limit: 20, offset: 0 }),
    matchesPageFilters: () => true,
    errorSnapshot: (error) => ({ ok: false, error: error.message }),
    SESSION_PAGE_SIZE: 20,
  });
  const diagnosticsPayload = await ipcMain.handlers["dashboard:getDiagnostics"]();
  assert.equal(diagnosticsPayload.ok, true);
  assert.equal(diagnosticsPayload.performance.aggregateCache.hits, 1);
  assert.equal(diagnosticsPayload.performance.usageRollup.pendingCount, 1);
  assert.equal(diagnosticsPayload.summary.status, "bad");
  assert.ok(["node:sqlite", "sql.js"].includes(diagnosticsPayload.summary.adapter));
  assert.equal(typeof diagnosticsPayload.summary.fallbackActive, "boolean");
  assert.ok(diagnosticsPayload.summary.sourceCount >= 2);
  assert.ok(diagnosticsPayload.summary.sourceStatus.desktop || diagnosticsPayload.summary.sourceStatus.cli);
  assert.ok(diagnosticsPayload.summary.missingSources.length >= 1);
  assert.equal(Object.prototype.hasOwnProperty.call(diagnosticsPayload.summary.missingSources[0], "dbPath"), false);
  assert.equal(typeof diagnosticsPayload.summary.missingSources[0].dbHash, "string");
  assert.ok(diagnosticsPayload.summary.nextActions.some((action) => action.code === "check_data_source"));
  assert.ok(diagnosticsPayload.summary.nextActions.some((action) => action.code === "review_slow_aggregates"));
  assert.ok(diagnosticsPayload.summary.nextActions.some((action) => action.code === "wait_sidecar_build"));
  assert.equal(diagnosticsPayload.summary.sidecar.pendingCount, 1);
  assert.equal(diagnosticsPayload.summary.sidecar.lastBuildStatus, "compact-hit");
  assert.equal(diagnosticsPayload.summary.sidecar.current.status, "retrying");
  assert.equal(diagnosticsPayload.summary.sidecar.current.fallback, "direct-sql");
  assert.equal(diagnosticsPayload.summary.sidecar.current.scannedRows, 30);
  assert.equal(diagnosticsPayload.summary.aggregateCache.hits, 1);
  assert.equal(diagnosticsPayload.summary.aggregateCache.limit, 64);
  assert.equal(diagnosticsPayload.performance.slowAggregates.count, 2);
  for (const key of ["database", "runtime", "logPath", "userData", "distPath"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(diagnosticsPayload, key), false, `diagnostics IPC must not expose raw ${key}`);
  }
  assert.doesNotMatch(JSON.stringify(diagnosticsPayload), new RegExp(tmpHome.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(diagnosticsPayload), /should-not-leak/);
  assert.equal(diagnosticsPayload.summary.slowAggregates.count, 2);
  assert.equal(diagnosticsPayload.summary.slowAggregates.failed, 1);
  assert.equal(diagnosticsPayload.summary.slowAggregates.maxMs, 768.2);
  assert.equal(diagnosticsPayload.summary.slowAggregates.last.label, "modelStats");
  assert.equal(diagnosticsPayload.summary.slowAggregates.byLabel.modelStats.maxMs, 768.2);
  assert.equal(diagnosticsPayload.summary.slowAggregates.byAdapter["sql.js"].count, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(diagnosticsPayload.summary.slowAggregates.last, "dbPath"), false);
  assert.equal(diagnosticsPayload.summary.resources.sqlWasm.name, "sql-wasm.wasm");
  assert.equal(diagnosticsPayload.summary.logs.logPathSafeName, "codearts-bar.log");
  assert.doesNotMatch(JSON.stringify(diagnosticsPayload.summary), new RegExp(tmpHome.replace(/[\\^$.*+?()[\\]{}|]/g, "\\$&")));
  const emptySummary = buildDiagnosticsSummary({
    database: {
      ok: true,
      items: [{
        id: "cli",
        label: "CLI",
        exists: true,
        readable: true,
        size: 4096,
        messageCount: 0,
        sessionCount: 0,
        dbPath: path.join(tmpHome, "cli-data", "opencode.db"),
      }],
      diagnostics: { issues: [] },
    },
    performance: {},
    runtime: null,
  }, path);
  assert.equal(emptySummary.emptyReadableSources.length, 1);
  assert.equal(emptySummary.emptyReadableSources[0].id, "cli");
  assert.ok(emptySummary.nextActions.some((action) => action.code === "produce_first_session"));
  assert.equal(Object.prototype.hasOwnProperty.call(emptySummary.emptyReadableSources[0], "dbPath"), false);
  console.log("ok - database diagnostics smoke");
} finally {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
}
})().catch((error) => {
  console.error(error);
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
