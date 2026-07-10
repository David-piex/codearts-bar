"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboardSourceFiles = [
  "dashboard.html",
  "dashboard.css",
  "styles/tokens.css",
  "styles/base.css",
  "dashboard-controls.css",
  "dashboard-analytics.css",
  "dashboard-sessions.css",
  "dashboard-chart.css",
  "dashboard-compact.css",
  "dashboard-responsive.css",
  "dashboard-native.css",
  "dashboard-layout.css",
  "dashboard-components.css",
  "styles/sessions-inspector.css",
  "styles/request-manager.css",
  "styles/session-library.css",
  "styles/native-controls-polish.css",
  "styles/usage-summary.css",
  "styles/responsive-states.css",
  "styles/layout.css",
  "styles/controls.css",
  "styles/analytics.css",
  "styles/sessions.css",
  "styles/chart.css",
  "styles/tables.css",
  "styles/popover.css",
  "styles/responsive.css",
];
const html = dashboardSourceFiles
  .map((file) => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"))
  .join("\n");
const rendererFiles = [
  "dashboard-renderer.js",
  "dashboard/i18n.js",
  "dashboard/dashboard-shell.js",
  "dashboard/dashboard-error-state.js",
  "dashboard/dashboard-diagnostics.js",
  "dashboard/dashboard-bootstrap.js",
  "dashboard/dashboard-perf.js",
  "dashboard/dashboard-slots.js",
  "dashboard/slots/slot-core.js",
  "dashboard/slots/analytics-slots.js",
  "dashboard/slots/data-page-core.js",
  "dashboard/slots/request-page-slot.js",
  "dashboard/slots/session-page-slot.js",
  "dashboard/slots/session-slots.js",
  "dashboard/slots/perf-panel-slot.js",
  "dashboard/events/date-events.js",
  "dashboard/events/chrome-events.js",
  "dashboard/events/session-events.js",
  "dashboard/events/analytics-events.js",
  "dashboard/events/form-events.js",
  "dashboard/dashboard-events.js",
  "dashboard/events/window-events.js",
  "dashboard-state.js",
  "dashboard-date-range.js",
  "dashboard/analytics/analytics-core.js",
  "dashboard/analytics/analytics-agent-idle.js",
  "dashboard-analytics.js",
  "dashboard/chart/chart-series.js",
  "dashboard/chart/chart-legend.js",
  "dashboard/chart/chart-canvas.js",
  "dashboard/chart/chart-tooltip.js",
  "dashboard/chart/chart-hover.js",
  "dashboard-chart.js",
  "dashboard-sessions.js",
  "dashboard/sessions/session-meta.js",
  "dashboard/sessions/session-filters.js",
  "dashboard/sessions/session-saved-views.js",
  "dashboard/sessions/session-bulk.js",
  "dashboard/sessions/session-cache-governance.js",
  "dashboard/sessions/session-inspector.js",
  "dashboard/sessions/session-table.js",
  "dashboard/sessions/session-workspace.js",
];
const renderer = rendererFiles
  .map((file) => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"))
  .join("\n");
const generatedRenderer = fs.readFileSync(path.join(__dirname, "..", "src", "dashboard-renderer.js"), "utf8");
const mainFiles = [
  "main.js",
  "main/logger.js",
  "main/tray.js",
  "main/window.js",
  "main/db-watch-service.js",
  "main/ipc-dashboard.js",
  "main/ipc-session.js",
  "main/ipc-settings.js",
  "main/lifecycle.js",
];
const mainProcess = mainFiles
  .map((file) => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"))
  .join("\n");

assert.match(html, /1\.17\.8 native control and material convergence/);
assert.match(html, /--native-font-ui:/);
assert.match(html, /--native-font-mono:/);
assert.match(html, /--native-control-height:34px/);
assert.match(html, /--native-control-bg:/);
assert.match(html, /--native-control-bg-pressed:/);
assert.match(html, /--native-control-bg-disabled:/);
assert.match(html, /--native-selection-bg:/);
assert.match(html, /--native-caret:#0a84ff/);
assert.match(html, /--native-placeholder:#9aa3b2/);
assert.match(html, /font-family:var\(--native-font-ui\)/);
assert.match(html, /font-family:var\(--native-font-mono\)/);
assert.match(html, /-webkit-tap-highlight-color:transparent/);
assert.match(html, /caret-color:var\(--native-caret\)/);
assert.match(html, /background:var\(--native-control-bg-pressed\)/);
assert.match(html, /background:var\(--native-control-bg-disabled\)/);
assert.match(html, /opacity:\.92/);
assert.match(html, /-webkit-font-smoothing:antialiased/);
assert.match(html, /-moz-osx-font-smoothing:grayscale/);
assert.match(html, /font-feature-settings:"kern" 1,"tnum" 1,"cv01" 1/);
assert.match(html, /:where\(button, input, select, textarea\)/);
assert.match(html, /:where\(button, select, input, textarea, canvas\):focus-visible/);
assert.match(html, /prefers-reduced-transparency: reduce/);
assert.match(html, /@supports not \(\(-webkit-backdrop-filter:blur\(1px\)\) or \(backdrop-filter:blur\(1px\)\)\)/);
assert.match(html, /scrollbar-width:thin/);
assert.match(html, /forced-colors: active/);
assert.match(html, /1\.18\.3 native segmented controls convergence/);
assert.match(html, /--native-segmented-bg:/);
assert.match(html, /--native-segmented-border:/);
assert.match(html, /--native-segmented-inset:/);
assert.match(html, /--native-segment-active-bg:/);
assert.match(html, /--native-segment-active-shadow:/);
assert.match(html, /--native-segment-hover:/);
assert.match(html, /:where\(\.workspace-tabs, \.source-switch, \.range, \.table-tabs\)/);
assert.match(html, /backdrop-filter:blur\(26px\) saturate\(1\.55\) contrast\(1\.02\)/);
assert.match(html, /mix-blend-mode:screen/);
assert.match(html, /\.workspace-tabs \.tab\.active::after/);
assert.match(html, /display:none/);
assert.match(html, /1\.17\.9 commercial cache insight center/);
assert.match(html, /cache-insights/);
assert.match(html, /cache-insight-grid/);
assert.match(html, /cache-insight-score/);
assert.doesNotMatch(renderer, /chartSnapshotHtml\(rows, s\)/);
assert.match(renderer, /chartTokenTrendMeta/);
assert.match(renderer, /cacheRead/);
assert.match(html, /chart-tip::before/);
assert.match(html, /chart-tip\.preview-pinned/);
assert.match(html, /chart-card\.chart-hover-preview/);
assert.match(html, /tip-row\.tip-state/);
assert.doesNotMatch(renderer, /tip-cache-bar/);
assert.doesNotMatch(renderer, /tip-row tip-metric/);
assert.match(html, /tip-pin/);
assert.doesNotMatch(renderer, /id="chartHoverScrubber"/);
assert.doesNotMatch(renderer, /scrubber-cache/);
assert.match(html, /scrubber-pin/);
assert.match(html, /width:var\(--hit,0%\)/);
assert.match(html, /1\.18\.1 commercial cache governance workbench/);
assert.match(html, /cache-governance/);
assert.match(html, /cache-governance-kpis/);
assert.match(html, /cache-governance-list/);
assert.match(html, /cache-governance-actions/);
assert.match(html, /1\.18\.0 agent rhythm card/);
assert.match(html, /agent-rhythm-card/);
assert.match(html, /agent-rhythm-rail/);
assert.match(html, /agent-rhythm-lists/);
assert.match(html, /session-saved-views/);
assert.match(html, /saved-view-composer/);
assert.match(html, /saved-view-row/);
assert.match(html, /saved-view-delete/);
assert.match(html, /1\.18\.2 simplified session management/);
assert.match(html, /session-simple-shell/);
assert.match(html, /session-primary-filters/);
assert.match(html, /session-saved-inline/);
assert.match(html, /session-library-status/);
assert.match(html, /session-table\.simple/);
assert.match(html, /session-actions-cell/);
assert.match(html, /session-row-actions/);
assert.match(html, /session-row-actions button/);
assert.match(html, /idle-summary-card/);
assert.match(html, /session-advanced-shell/);
assert.match(html, /session-advanced-controls/);
assert.match(html, /1\.18\.4 native table and inspector surface/);
assert.match(html, /session-inspector,/);
assert.match(html, /request-manager-flat/);
assert.doesNotMatch(renderer, /renderRequestInspector/);
assert.match(html, /table-toolbar/);
assert.match(html, /backdrop-filter:blur\(22px\) saturate\(1\.34\)/);
assert.match(html, /1\.18\.5 analytics total overview board/);
assert.match(html, /usage-total-board/);
assert.match(html, /usage-total-hero/);
assert.match(html, /usage-total-strip/);
assert.match(html, /usage-total-cache/);
assert.match(html, /usage-total-request-spark/);
assert.match(html, /--cache-hit:/);
assert.match(html, /grid-template-columns:repeat\(4,minmax\(140px,1fr\)\) minmax\(220px,1\.25fr\)/);
assert.match(html, /1\.18\.6 commercial usage board refinement/);
assert.match(html, /\.cc-usage-summary\.usage-summary/);
assert.match(html, /background:transparent/);
assert.match(html, /usage-detail-stack/);
assert.match(html, /blur\(22px\) saturate\(1\.30\)/);
assert.match(html, /prefers-reduced-motion: reduce/);
assert.match(html, /1\.18\.7 lightweight session inspector/);
assert.match(html, /session-essential-inspector/);
assert.match(html, /session-essential-actions/);
assert.match(html, /session-essential-summary/);
assert.match(html, /session-essential-meta/);
assert.match(html, /session-essential-cache/);
assert.match(html, /--session-hit:/);
assert.match(html, /1\.18\.8 commercial native table polish/);
assert.match(html, /session-table\.simple \.session-row\.selected td/);
assert.match(html, /session-table\.simple \.session-row\.selected td:first-child/);
assert.match(html, /\.cache-pill i/);
assert.match(html, /\.cache-pill i::before/);
assert.match(html, /width:var\(--hit,0%\)/);
assert.match(html, /1\.18\.9 commercial intent clarity and usage cache emphasis/);
assert.match(html, /usage-total-board\.cache-hot/);
assert.match(html, /usage-total-board\.cache-warm/);
assert.match(html, /usage-total-board\.cache-cold/);
assert.doesNotMatch(html, /session-intent-row/);
assert.match(html, /session-primary-filters/);
assert.match(html, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.doesNotMatch(html, /global-cache-pill/);
assert.match(html, /1\.18\.10 commercial toolbar de-duplication and native density/);
assert.match(html, /\.page-head \.filters/);
assert.match(html, /min-height:44px/);
assert.match(html, /0 8px 18px rgba\(24,39,65,\.035\)/);
assert.match(html, /1\.18\.11 footer-safe chart hover visibility/);
assert.match(html, /--footer-safe-space:64px/);
assert.match(html, /scroll-padding-bottom:var\(--footer-safe-space\)/);
assert.match(html, /scroll-margin-bottom:var\(--footer-safe-space\)/);
assert.match(html, /1\.18\.12 commercial session first-screen density/);
assert.match(html, /grid-template-columns:minmax\(0,1\.02fr\) minmax\(360px,\.98fr\)/);
assert.match(html, /\.session-workspace-card \.session-manager/);
assert.match(html, /min-height:520px/);
assert.match(html, /1\.18\.13 commercial chart hover aperture/);
assert.match(renderer, /drawHoverAperture/);
assert.match(renderer, /createRadialGradient/);
assert.match(renderer, /animatePinnedHover/);
assert.match(html, /chartPinnedScrub/);
assert.match(html, /scrubber-focus/);


assert.match(html, /1\.19\.0 performance and native visual unification pass/);
assert.match(html, /1\.19\.0 local rendering layout pass/);
assert.match(html, /1\.19\.0 denser commercial table, hover and state polish/);
assert.match(html, /href="dashboard\.css"/);
assert.match(html, /href="styles\/tokens\.css"/);
assert.match(html, /href="styles\/base\.css"/);
assert.match(html, /href="dashboard-native\.css"/);
assert.match(html, /href="dashboard-layout\.css"/);
assert.match(html, /href="dashboard-components\.css"/);
assert.match(html, /href="dashboard-controls\.css"/);
assert.match(html, /href="dashboard-analytics\.css"/);
assert.match(html, /href="dashboard-sessions\.css"/);
assert.match(html, /href="dashboard-chart\.css"/);
assert.match(html, /href="dashboard-compact\.css"/);
assert.match(html, /href="dashboard-responsive\.css"/);
assert.match(html, /href="styles\/sessions-inspector\.css"/);
assert.match(html, /href="styles\/request-manager\.css"/);
assert.match(html, /href="styles\/session-library\.css"/);
assert.match(html, /href="styles\/native-controls-polish\.css"/);
assert.match(html, /href="styles\/usage-summary\.css"/);
assert.match(html, /href="styles\/responsive-states\.css"/);
assert.match(html, /href="styles\/layout\.css"/);
assert.match(html, /href="styles\/controls\.css"/);
assert.match(html, /href="styles\/analytics\.css"/);
assert.match(html, /href="styles\/sessions\.css"/);
assert.match(html, /href="styles\/chart\.css"/);
assert.match(html, /href="styles\/tables\.css"/);
assert.match(html, /href="styles\/popover\.css"/);
assert.match(html, /href="styles\/responsive\.css"/);
assert.match(html, /1\.20\.1 semantic token layer/);
assert.match(html, /--cb-radius-sm: var\(--radius-sm, 10px\)/);
assert.match(html, /--cb-control-height: var\(--control-height, 34px\)/);
assert.match(html, /--cb-surface-panel: var\(--surface-panel/);
assert.match(html, /--cb-surface-card: var\(--surface-card/);
assert.match(html, /--cb-border-soft: var\(--border-soft/);
assert.match(html, /--cb-shadow-card: var\(--shadow-card/);
assert.match(html, /--cb-shadow-popover: var\(--shadow-popover/);
assert.match(html, /1\.20\.1 semantic base layer/);
assert.match(html, /font-family: var\(--cb-font-ui\)/);
assert.match(html, /1\.20\.2 semantic controls layer/);
assert.match(html, /box-shadow: var\(--cb-shadow-control\)/);
assert.match(html, /1\.20\.2 semantic layout layer/);
assert.match(html, /--cb-page-pad-x:/);
assert.match(html, /date-range-popover/);
assert.match(html, /transition-duration: 0ms !important/);
assert.match(html, /max-height:calc\(100vh - 118px\)/);
assert.match(html, /1\.20\.2 semantic analytics layer/);
assert.match(html, /--cache-panel-accent: var\(--cb-accent\)/);
assert.match(html, /1\.20\.2 semantic sessions layer/);
assert.match(html, /inset 3px 0 0 var\(--cb-accent\)/);
assert.match(html, /1\.20\.2 semantic chart layer/);
assert.match(html, /contain: layout paint style/);
assert.match(html, /1\.20\.1 semantic table layer/);
assert.match(html, /background: var\(--cb-row-hover\)/);
assert.match(html, /box-shadow: var\(--cb-shadow-control\)/);
assert.match(html, /1\.20\.1 semantic popover layer/);
assert.match(html, /background: var\(--cb-surface-popover\)/);
assert.match(html, /box-shadow: var\(--cb-shadow-popover\)/);
assert.match(html, /1\.20\.2 semantic responsive layer/);
for (const file of dashboardSourceFiles.filter((name) => name.endsWith(".css"))) {
  const size = fs.statSync(path.join(__dirname, "..", "src", file)).size;
  assert.ok(size < 25 * 1024, `${file} should stay below 25KB after semantic CSS split`);
}
assert.match(renderer, /analyticsSummarySlot/);
assert.match(renderer, /analyticsChartSlot/);
assert.match(renderer, /analyticsTableSlot/);
assert.match(renderer, /analyticsAdvancedSlot/);
assert.match(renderer, /patchAnalyticsView/);
assert.match(renderer, /appendRequestRows/);
assert.match(renderer, /async function appendSessionRows/);
assert.match(renderer, /return false;\s*}\s*function hydrateSessionRows/);
assert.match(renderer, /insertAdjacentHTML/);
assert.match(renderer, /requestRowHtml/);
assert.match(renderer, /sessionRowHtml/);
assert.match(renderer, /dashboard\/i18n\.js/);
assert.match(renderer, /dashboard\/dashboard-shell\.js/);
assert.match(renderer, /dashboard\/dashboard-error-state\.js/);
assert.match(renderer, /dashboard\/dashboard-diagnostics\.js/);
assert.match(renderer, /dashboard\/dashboard-bootstrap\.js/);
assert.match(renderer, /dashboard\/dashboard-perf\.js/);
assert.match(renderer, /dashboard\/dashboard-slots\.js/);
assert.match(renderer, /dashboard\/slots\/analytics-slots\.js/);
assert.match(renderer, /dashboard\/slots\/data-page-core\.js/);
assert.match(renderer, /dashboard\/slots\/request-page-slot\.js/);
assert.match(renderer, /dashboard\/slots\/session-page-slot\.js/);
assert.match(renderer, /dashboard\/slots\/session-slots\.js/);
assert.match(renderer, /dashboard\/slots\/perf-panel-slot\.js/);
assert.match(renderer, /dashboard\/dashboard-events\.js/);
assert.match(renderer, /dashboard\/events\/date-events\.js/);
assert.match(renderer, /dashboard\/events\/chrome-events\.js/);
assert.match(renderer, /dashboard\/events\/session-events\.js/);
assert.match(renderer, /dashboard\/events\/analytics-events\.js/);
assert.match(renderer, /dashboard\/events\/form-events\.js/);
assert.match(renderer, /dashboard\/events\/window-events\.js/);
assert.match(renderer, /dashboard\/sessions\/session-meta\.js/);
assert.match(renderer, /dashboard\/sessions\/session-filters\.js/);
assert.match(renderer, /dashboard\/sessions\/session-saved-views\.js/);
assert.match(renderer, /dashboard\/sessions\/session-bulk\.js/);
assert.match(renderer, /dashboard\/sessions\/session-cache-governance\.js/);
assert.match(renderer, /dashboard\/sessions\/session-inspector\.js/);
assert.match(renderer, /dashboard\/sessions\/session-table\.js/);
assert.match(renderer, /dashboard\/sessions\/session-workspace\.js/);
assert.match(renderer, /sessionInspectorSlot/);
assert.match(renderer, /sessionTableSlot/);
assert.match(renderer, /sessionOverviewSlot/);
assert.match(renderer, /sessionToolbarSlot/);
assert.match(renderer, /sessionModalSlot/);
assert.match(renderer, /渲染性能/);
assert.doesNotMatch(renderer, /\?\?\?\?/);
assert.doesNotMatch(renderer, /鐮侀亾|鈥|�/);
assert.match(renderer, /togglePerfPanel/);
assert.match(renderer, /refreshPerfDiagnostics/);
assert.match(renderer, /dashboard:getDiagnostics/);
assert.match(renderer, /copyPerformanceReport/);
assert.match(renderer, /data-copy-perf-report/);
assert.match(renderer, /dashboard-performance/);
assert.match(renderer, /聚合缓存/);
assert.match(renderer, /perfPanelSlowHint/);
assert.match(renderer, /冷聚合/);
assert.match(renderer, /sidecar/);
assert.match(renderer, /rollup miss/);
assert.match(renderer, /慢聚合/);
assert.match(renderer, /slowAggregates/);
assert.match(renderer, /max \$\{perfPanelMs\(slow\.maxMs\)\}/);
assert.match(renderer, /pending/);
assert.match(renderer, /lastBuildMs/);
assert.match(renderer, /last build/);
assert.match(html, /\.perf-section/);
assert.match(html, /\.perf-copy/);
assert.match(html, /perf-ok/);
assert.match(html, /perf-warn/);
assert.match(html, /perf-bad/);
assert.match(renderer, /dashboard:getAggregates/);
assert.match(renderer, /scheduleDashboardAggregates/);
assert.match(renderer, /dashboardAggregateInteractionActive/);
assert.match(renderer, /dashboardAggregateDelay/);
assert.match(renderer, /runScheduledDashboardAggregates/);
assert.doesNotMatch(renderer, /setTimeout\(\(\) => refreshDashboardAggregates\(s, token\), 45\)/);
assert.match(generatedRenderer, /Generated by src\/build-dashboard-renderer\.js/);
assert.match(generatedRenderer, /Renderer parts:/);
assert.doesNotMatch(generatedRenderer, /\beval\s*\(/);
assert.doesNotMatch(generatedRenderer, /\breadRendererPart\b/);
assert.doesNotMatch(generatedRenderer, /\brendererPartPath\b/);


assert.match(renderer, /TABLE_PAGE_SIZE_OPTIONS = \[20, 50, 100\]/);
assert.doesNotMatch(renderer, /TABLE_PAGE_SIZE_OPTIONS = \[10, 20, 50, 100\]/);
assert.match(renderer, /REQUEST_PAGE_SIZE = normalizeTablePageSize/);
assert.match(renderer, /requestTableRenderLimit = REQUEST_PAGE_SIZE/);
assert.match(renderer, /requestTablePage/);
assert.match(renderer, /data-request-page-size/);
assert.match(renderer, /data-session-page-size/);
assert.match(renderer, /data-request-page-input/);
assert.match(renderer, /data-session-page-input/);
assert.match(html, /1\.19\.2 aligned filter toolbar and explicit table pagination/);
assert.match(html, /table-page-actions/);
assert.match(renderer, /SESSION_PAGE_SIZE = normalizeTablePageSize/);
assert.match(renderer, /sessionTableRenderLimit = SESSION_PAGE_SIZE/);
assert.match(renderer, /normalizePageInputToIndex/);
assert.match(renderer, /maxTablePageIndex/);
assert.match(renderer, /scrollPagedTableToTop/);
assert.match(renderer, /dateRangeDraftValidation/);
assert.match(renderer, /data-date-range-error/);
assert.match(renderer, /dateRangeOrderInvalid/);
assert.match(renderer, /data-date-range-confirm/);
assert.match(renderer, /preserveDatePopover/);
assert.match(renderer, /preserveFilters/);
assert.match(renderer, /patchDateRangeChrome\?\.\(\)/);
assert.match(html, /\.date-range-error/);
assert.match(html, /\.date-range-actions \.primary:disabled/);
assert.match(renderer, /setPagedTableLoading/);
assert.match(renderer, /pageInputState/);
assert.match(renderer, /setPagedTableFeedback/);
assert.match(renderer, /pagedTableFeedbackTimers/);
assert.doesNotMatch(renderer, /let pagedTableFeedbackTimer = null/);
assert.match(renderer, /is-page-adjusted/);
assert.match(renderer, /syncPagedTableInput/);
assert.match(renderer, /data-request-page-input/);
assert.match(renderer, /data-session-page-input/);
assert.match(renderer, /data-request-page-go/);
assert.match(renderer, /data-session-page-go/);
assert.match(html, /\.table-page-note\.is-page-loading/);
assert.match(html, /\.table-scroll\.is-page-loading/);
assert.match(html, /\.session-scroll\.is-page-loading/);
assert.match(html, /\.table-page-note\.is-page-adjusted/);
assert.match(renderer, /renderer-resize-perf/);
assert.match(renderer, /resizeStart/);
assert.match(renderer, /resizeQuietWait/);
assert.match(renderer, /chartRedraw/);
assert.match(renderer, /minValidTimestamp/);
assert.doesNotMatch(renderer, /Math\.min\(\.\.\.times\)/);
assert.doesNotMatch(renderer, /rows\.map\(\(r\) => Number\(r\.time \|\| 0\)\.filter/);
assert.match(renderer, /renderer-perf/);
assert.match(renderer, /filterMs/);
assert.match(renderer, /chartDrawMs/);
assert.match(renderer, /domCommitMs/);
assert.match(renderer, /tableRenderMs/);
assert.match(renderer, /bindIncrementalTables/);
assert.match(renderer, /lastChartTipKey/);
assert.match(renderer, /contentChanged/);
assert.match(mainProcess, /registerDashboardIpc/);
assert.match(mainProcess, /registerSessionIpc/);
assert.match(mainProcess, /registerSettingsIpc/);
assert.match(mainProcess, /requestSingleInstance/);
assert.match(mainProcess, /createDashboardWindow/);
assert.match(mainProcess, /createLogger/);
assert.match(mainProcess, /createDbWatchService/);
assert.match(mainProcess, /targetFingerprint/);

console.log("ok - dashboard style smoke");


