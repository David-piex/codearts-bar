'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pluginRoot = path.join(root, 'jetbrains-plugin');
const required = [
  'build.gradle.kts', 'settings.gradle.kts', 'gradlew.bat',
  'src/main/resources/META-INF/plugin.xml',
  'src/main/java/com/codearts/bar/cli/CliProcessRunner.java',
  'src/main/java/com/codearts/bar/cli/EmbeddedCliRuntime.java',
  'src/main/java/com/codearts/bar/actions/DataFolderResolver.java',
  'src/main/java/com/codearts/bar/model/AnalyticsRange.java',
  'src/main/java/com/codearts/bar/model/DataSourceIdentity.java',
  'src/main/java/com/codearts/bar/model/QueryDisplayState.java',
  'src/main/java/com/codearts/bar/model/SensitiveText.java',
  'src/main/java/com/codearts/bar/service/CodeArtsDataService.java',
  'src/main/java/com/codearts/bar/service/RefreshCoordinator.java',
  'src/main/java/com/codearts/bar/settings/SettingsValues.java',
  'src/main/java/com/codearts/bar/statusbar/CodeArtsStatusBarWidgetFactory.java',
  'src/main/java/com/codearts/bar/toolwindow/CodeArtsToolWindowFactory.java',
  'src/main/java/com/codearts/bar/toolwindow/CodeArtsDashboardPanel.java',
  'src/main/java/com/codearts/bar/toolwindow/DashboardUi.java',
  'src/main/java/com/codearts/bar/toolwindow/TrendChartPanel.java',
  'src/main/java/com/codearts/bar/settings/CodeArtsConfigurable.java',
];
for (const file of required) {
  assert.ok(fs.existsSync(path.join(pluginRoot, file)), `missing JetBrains plugin file: ${file}`);
}
const dashboardSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/toolwindow/CodeArtsDashboardPanel.java'), 'utf8');
const uiSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/toolwindow/DashboardUi.java'), 'utf8');
assert.match(dashboardSource, /disposed \|\| generation != analyticsQueryGeneration\.get\(\)/, 'analytics callbacks must ignore disposed panels');
assert.match(dashboardSource, /UsageSnapshot baseSnapshot = service\.getSnapshot\(\);[\s\S]*renderReadFailure\(baseSnapshot\.error\(\)\)/, 'base data-source errors must take priority over analytics range errors');
assert.match(dashboardSource, /current = snapshot;\s*if \(!snapshot\.ok\(\)\)/, 'failed snapshots must become the authoritative dashboard state');
assert.match(dashboardSource, /analyticsQueryGeneration\.incrementAndGet\(\);[\s\S]*sessionQueryGeneration\.incrementAndGet\(\);/, 'dispose must invalidate all pending dashboard queries');
assert.match(dashboardSource, /new JComboBox<>\(AnalyticsRange\.values\(\)\)/, 'usage analytics must expose the global time-range selector');
assert.match(dashboardSource, /configureAccessibility\(\)/, 'tool-window controls must expose accessible names');
assert.match(dashboardSource, /safeText\(empty\(row\.title\(\)/, 'session titles must be redacted before entering visible UI');
assert.match(uiSource, /stringWidth\(rich\.title\(\)\) <= available[\s\S]*boundedTooltip/, 'table tooltips must only appear for clipped text');
assert.match(uiSource, /<body width='320'>/, 'long table tooltips must wrap to a bounded native tooltip');
assert.match(uiSource, /AccessibleRole\.RADIO_BUTTON/, 'segmented navigation must expose radio-button semantics');
assert.match(uiSource, /previousSegment[\s\S]*nextSegment/, 'segmented navigation must support arrow-key switching');
assert.match(dashboardSource, /usageHero\.setMetrics\(tokens\(usage\.total\(\)\), number\(usage\.total\(\)\)/, 'the hero token metric must stay compact in narrow tool windows while retaining exact data');
assert.match(uiSource, /setToolTipText\("总 Token：" \+ exactTotal\)/, 'the compact hero metric must expose its exact token count');
assert.match(uiSource, /while \(size > 16f[\s\S]*stringWidth\(value\.getText\(\)\) > available/, 'the hero metric must adapt its font to the actual narrow-tool-window width');
assert.doesNotMatch(uiSource, /setToolTipText\(nextDetail\)/, 'metric cards must not show duplicate low-value detail tooltips');
assert.match(dashboardSource, /"--start"[\s\S]*"--end"[\s\S]*"--bucket-ms"[\s\S]*"--bucket-offset-ms"/, 'analytics queries must carry the selected local-time range to the CLI');
assert.match(dashboardSource, /transitionSafeBucketMs[\s\S]*queryBucketMs = calendarRebucket \? transitionBucketMs/, 'daily analytics must use an offset-safe source bucket across daylight-saving transitions');
assert.match(dashboardSource, /withLocalDailyTrend\(analytics, window\.start\(\), window\.end\(\), zone\)/, 'DST-safe hourly results must be regrouped by real local calendar days');
assert.match(dashboardSource, /CustomRangeDialog/, 'usage analytics must support a native custom time-range dialog');
assert.match(dashboardSource, /JComboBox<AnalyticsRange> sessionTimeRange/, 'session filtering must share the typed analytics time-range model');
assert.match(dashboardSource, /sessionRange = range\.id\(\)/, 'session time-range selection must persist across IDE restarts');
assert.match(dashboardSource, /settings\.sessionCustomStart[\s\S]*settings\.sessionCustomEnd/, 'session filtering must support custom time bounds');
assert.match(dashboardSource, /installCustomRangeReopen\(usageRange[\s\S]*installCustomRangeReopen\(sessionTimeRange/, 'persisted custom ranges must remain directly editable in both selectors');
assert.match(dashboardSource, /popupMenuCanceled[\s\S]*canceled = true/, 'canceling an open range menu must not launch the custom editor');
assert.match(dashboardSource, /sessionTimeRange\.setToolTipText\(sessionDescription\)/, 'session custom ranges must expose their exact persisted bounds');
assert.match(dashboardSource, /analyticsDisplay\.markSuccess\(label\)[\s\S]*analyticsDisplay\.failure\(label, message\)/, 'failed range replacements must identify the analytics result still on screen');
assert.match(dashboardSource, /sessionDisplay\.markSuccess\(queryLabel\)[\s\S]*sessionDisplay\.failure\(queryLabel, message\)/, 'failed session filters must identify the previous result still on screen');
assert.match(dashboardSource, /DataSourceIdentity\.changed\(displayedDataSource, configuredDatabase\)[\s\S]*clearDisplayedDataSource\(\)/, 'failed explicit database switches must clear results from the previous source');
assert.match(dashboardSource, /clearDisplayedDataSource\(\)[\s\S]*analyticsDisplay\.reset\(\)[\s\S]*sessionDisplay\.reset\(\)/, 'cross-source switches must reset every visible query owner');
assert.match(dashboardSource, /button\("查看诊断", \(\) -> showView\(VIEW_DIAGNOSTICS\)\)/, 'read failures must provide a direct path to diagnostics');
assert.match(dashboardSource, /overviewErrorDescription\.setText\(error/, 'read failures must expose their actionable cause on the error page');
assert.match(dashboardSource, /analyticsViewButton\.setSelected\(VIEW_ANALYTICS\.equals\(view\)\)[\s\S]*diagnosticsViewButton\.setSelected\(VIEW_DIAGNOSTICS\.equals\(view\)\)/, 'programmatic view changes must keep segmented navigation selected state synchronized');
assert.match(dashboardSource, /cancelQuery\(analyticsQueryTask\)/, 'range changes and disposal must cancel obsolete analytics work');
assert.match(dashboardSource, /cancelQuery\(sessionQueryTask\)/, 'dashboard disposal must cancel session queries');
assert.match(dashboardSource, /cancelQuery\(requestQueryTask\)/, 'session changes and disposal must cancel request queries');
assert.match(dashboardSource, /new GridLayout\(1, 2, JBUI\.scale\(6\), 0\)/, 'narrow session filters must keep both time and source controls visible');
assert.match(dashboardSource, /allowNarrow\(this\)/, 'the dashboard must not impose a desktop-width minimum on the tool window');
const rangeSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/model/AnalyticsRange.java'), 'utf8');
const snapshotSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/model/UsageSnapshot.java'), 'utf8');
assert.match(rangeSource, /CUSTOM\("custom", "自定义…"/, 'time ranges must include the desktop-style custom range');
assert.match(rangeSource, /duration <= 2L \* DAY_MS/, 'custom ranges must choose readable hourly or daily chart buckets');
assert.match(rangeSource, /nextTransition[\s\S]*greatestCommonDivisor/, 'time ranges must derive a safe bucket for non-hour daylight-saving transitions');
assert.match(snapshotSource, /dayCount > MAX_DENSE_TREND_BUCKETS[\s\S]*totals\.entrySet\(\)/, 'all-time local-day trends must remain sparse instead of allocating decades of zero buckets');
const settingsSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/settings/CodeArtsConfigurable.java'), 'utf8');
assert.doesNotMatch(settingsSource, /showStatusBar/, 'status bar visibility must use the native IDEA widgets menu');
assert.match(settingsSource, /SettingsValues\.parse/, 'settings must validate numeric values before applying');
const statusBarSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/statusbar/CodeArtsStatusBarWidgetFactory.java'), 'utf8');
assert.match(statusBarSource, /isAvailable\([^)]*\) \{ return true; \}/, 'status bar widget must remain available to the native IDEA widgets menu');
const runnerSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/cli/CliProcessRunner.java'), 'utf8');
const locatorSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/cli/CliLocator.java'), 'utf8');
const embeddedSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/cli/EmbeddedCliRuntime.java'), 'utf8');
const serviceSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/service/CodeArtsDataService.java'), 'utf8');
const refreshCoordinatorSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/service/RefreshCoordinator.java'), 'utf8');
assert.match(runnerSource, /catch \(InterruptedException interrupted\)[\s\S]*terminate\(process\)/, 'CLI interruption must terminate the child process');
assert.doesNotMatch(locatorSource, /findOnPath\("codearts-bar(?:\.cmd)?"\)/, 'embedded CLI failures must not silently execute a global CLI from PATH');
assert.match(locatorSource, /内嵌 CodeArts Bar CLI 无法准备：[\s\S]*IDE system 目录权限[\s\S]*明确指定 CLI 路径/, 'embedded CLI preparation failures must remain actionable');
assert.match(embeddedSource, /static synchronized Path materialize\(\) throws IOException/, 'production embedded CLI materialization must expose integrity and extraction failures');
assert.match(runnerSource, /数据库文件不存在/, 'missing database paths must produce an actionable error');
assert.match(runnerSource, /未找到 Node\.js/, 'missing Node.js must produce an actionable error');
assert.match(embeddedSource, /requiredString\(manifest, "contentHash"\)/, 'embedded CLI extraction must use reproducible content-addressed directories');
assert.match(embeddedSource, /cleanupOldVersions[\s\S]*cli-\[0-9a-f\]/, 'embedded CLI upgrades must clean only obsolete content-addressed runtime directories');
assert.match(embeddedSource, /expectedHash\.equals\(sha256\(target\)\)/, 'cached embedded CLI files must pass integrity validation before reuse');
assert.match(embeddedSource, /cachedFilesUnchanged\(\)[\s\S]*FileStamp\.read/, 'hot embedded CLI queries must use low-cost metadata validation before full hashing');
assert.match(embeddedSource, /expectedHash\.equals\(sha256\(temp\)\)[\s\S]*failed integrity verification/, 'embedded CLI resources must be verified before atomic installation');
assert.match(runnerSource, /repairEmbeddedRuntime\(command\)[\s\S]*queryCommand/, 'embedded CLI execution failures must retry once only after an actual integrity repair');
assert.match(embeddedSource, /runtimeIsIntact[\s\S]*repairAfterFailure/, 'failure recovery must force full runtime hashing beyond the metadata hot path');
assert.match(embeddedSource, /isSymbolicLink\(root\)[\s\S]*runtime directory is a symbolic link/, 'embedded CLI extraction must reject linked content-addressed roots');
assert.match(embeddedSource, /holdRuntimeLock[\s\S]*deleteTreeIfUnlocked/, 'embedded CLI cleanup must preserve runtime versions used by another IDE process');
assert.match(serviceSource, /CliLocator\.releaseEmbeddedRuntime\(\)/, 'dynamic plugin unload must release the embedded runtime file lock explicitly');
assert.match(serviceSource, /Set<Future<\?>> activeTasks[\s\S]*submitTracked/, 'the application service must track refresh and query work for plugin unload');
assert.match(serviceSource, /disposed = true;[\s\S]*activeTasks\) task\.cancel\(true\)/, 'plugin unload must interrupt every active CLI task');
assert.match(serviceSource, /if \(!disposed\) listeners\.forEach/, 'queued refresh callbacks must not reach disposed plugin UI');
assert.match(serviceSource, /catch \(InterruptedException interrupted\)[\s\S]*Thread\.currentThread\(\)\.interrupt\(\)/, 'cancelled refreshes must preserve interruption instead of becoming false data-source failures');
assert.match(serviceSource, /catch \(RuntimeException rejected\)[\s\S]*activeTasks\.remove\(task\)[\s\S]*task\.cancel\(false\)/, 'executor shutdown must not leak a task that was never accepted');
assert.match(serviceSource, /synchronized AutoCloseable subscribe/, 'subscription and service disposal must share a lifecycle boundary');
assert.match(serviceSource, /startRefresh\(refreshCoordinator\.request\(notifyOnError\)\)/, 'concurrent refresh requests must be coordinated instead of discarded');
assert.match(refreshCoordinatorSource, /pendingNotification \|= notifyOnError[\s\S]*new Start\(true, notifyOnError\)/, 'coalesced refreshes must preserve error-notification intent for the follow-up run');
assert.match(serviceSource, /createNotification\("码道刷新失败", message/, 'deferred refresh notifications must capture their own failure instead of reading a later snapshot');
assert.match(serviceSource, /catch \(RuntimeException rejected\)[\s\S]*refreshCoordinator\.abort\(\)/, 'rejected refresh submission must not leave the service stuck in refreshing state');
const gradleProperties = fs.readFileSync(path.join(pluginRoot, 'gradle.properties'), 'utf8');
assert.match(gradleProperties, /^pluginUntilBuild=253\.\*$/m, 'verified JetBrains compatibility ceiling must remain explicit');
for (const sourceFile of ['DashboardUi.java', 'TrendChartPanel.java']) {
  const source = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/toolwindow', sourceFile), 'utf8');
  assert.doesNotMatch(source, /JBUI\.scale\([0-9.]+f\)/, `${sourceFile} must not use deprecated JBUI.scale(float)`);
}
const chartSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/toolwindow/TrendChartPanel.java'), 'utf8');
assert.match(chartSource, /points\.get\(index\)\.start\(\) - first/, 'sparse trend points must use real-time x coordinates');
assert.match(chartSource, /boolean gap = index > 0/, 'sparse trend series must break across missing time buckets');
assert.match(chartSource, /setFocusable\(true\)/, 'trend chart must participate in keyboard focus traversal');
assert.match(chartSource, /previousPoint[\s\S]*nextPoint[\s\S]*firstPoint[\s\S]*lastPoint/, 'trend chart must support keyboard point navigation');
assert.match(chartSource, /updateAccessibleDescription\(\)/, 'trend chart must announce the selected point');
const xml = fs.readFileSync(path.join(pluginRoot, 'src/main/resources/META-INF/plugin.xml'), 'utf8');
for (const marker of ['statusBarWidgetFactory', 'toolWindow', 'applicationConfigurable', 'CodeArtsBar.Refresh']) assert.ok(xml.includes(marker), `plugin.xml missing ${marker}`);
const openActionSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/actions/OpenToolWindowAction.java'), 'utf8');
const refreshActionSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/actions/RefreshAction.java'), 'utf8');
const folderActionSource = fs.readFileSync(path.join(pluginRoot, 'src/main/java/com/codearts/bar/actions/OpenDataFolderAction.java'), 'utf8');
assert.match(openActionSource, /extends DumbAwareAction/, 'the tool-window action must remain available while IDEA is indexing');
assert.match(refreshActionSource, /extends DumbAwareAction/, 'usage refresh must remain available while IDEA is indexing');
assert.match(folderActionSource, /extends DumbAwareAction/, 'the data-folder action must remain available while IDEA is indexing');
assert.match(folderActionSource, /InvalidPathException[\s\S]*notifyFailure/, 'invalid persisted database paths must not escape onto the IDEA event thread');
assert.match(folderActionSource, /!Files\.isDirectory\(folder\)/, 'the data-folder action must explain missing directories instead of opening an invalid target');
assert.match(folderActionSource, /snapshot\.ok\(\) \? snapshot\.dbPath\(\) : ""/, 'the data-folder action must prefer the database actually used by the current successful snapshot');
assert.match(folderActionSource, /DataFolderResolver\.resolveDatabase\(actualDatabase, configured/, 'data-folder fallback behavior must remain centralized and testable');
assert.match(folderActionSource, /Files\.isRegularFile\(database\)[\s\S]*RevealFileAction\.openFile\(database\)/, 'the actual database must be revealed in the native file manager through a supported JetBrains API');
assert.doesNotMatch(folderActionSource, /ShowFilePathAction|BrowserUtil\.browse/, 'the data-folder action must not use browser or popup-only path APIs');
assert.doesNotMatch(folderActionSource, /BrowserUtil\.browse/, 'local Windows paths must not be encoded as browser URLs');
assert.match(openActionSource, /window\.activate\(null, true\)/, 'the open action must focus the analytics tool window');
assert.match(xml, /CodeArtsBar\.OpenToolWindow[\s\S]*add-to-group group-id="ToolsMenu"/, 'usage analytics must be discoverable from the native Tools menu');
const distributions = path.join(pluginRoot, 'build', 'distributions');
assert.ok(fs.existsSync(distributions), 'JetBrains distribution directory missing; run build:jetbrains');
const zip = fs.readdirSync(distributions).find((name) => name.endsWith('.zip'));
assert.ok(zip, 'JetBrains plugin ZIP missing');
if (process.platform === 'win32') {
  const entries = execFileSync('tar.exe', ['-tf', path.join(distributions, zip)], { encoding: 'utf8' });
  assert.match(entries, /codearts-bar-jetbrains\/lib\/codearts-bar-jetbrains-[^/]+\.jar/);
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-jetbrains-zip-'));
  try {
    execFileSync('tar.exe', ['-xf', path.join(distributions, zip), '-C', extractDir]);
    const jarDir = path.join(extractDir, 'codearts-bar-jetbrains', 'lib');
    const jar = fs.readdirSync(jarDir).find((name) => /^codearts-bar-jetbrains-[^/]+\.jar$/.test(name) && !name.includes('searchableOptions'));
    assert.ok(jar, 'JetBrains plugin archive must contain the primary plugin JAR');
    const jarPath = path.join(jarDir, jar);
    const jarEntries = execFileSync('tar.exe', ['-tf', jarPath], { encoding: 'utf8' });
    assert.match(jarEntries, /cli\/src\/providers\/codearts\/jetbrains-cli\.js/);
    assert.match(jarEntries, /cli\/node_modules\/sql\.js\/dist\/sql-wasm\.wasm/);
    const jarExtractDir = path.join(extractDir, 'jar');
    fs.mkdirSync(jarExtractDir);
    execFileSync('tar.exe', ['-xf', jarPath, '-C', jarExtractDir]);
    const cliDir = path.join(jarExtractDir, 'cli');
    const manifest = JSON.parse(fs.readFileSync(path.join(cliDir, 'CLI_RUNTIME_MANIFEST.json'), 'utf8'));
    assert.equal(manifest.entry, 'src/providers/codearts/jetbrains-cli.js', 'embedded CLI manifest must use the dedicated query entry');
    assert.match(manifest.contentHash, /^[0-9a-f]{64}$/, 'embedded CLI manifest must include its content hash');
    const hashes = Object.entries(manifest.hashes || {}).sort(([left], [right]) => left.localeCompare(right));
    assert.equal(hashes.length, (manifest.files || []).length + 2, 'embedded CLI manifest must hash every source and sql.js resource');
    const contentDigest = crypto.createHash('sha256');
    for (const [relative, expectedHash] of hashes) {
      assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'), `embedded CLI path must remain relative: ${relative}`);
      const resource = path.join(cliDir, ...relative.split('/'));
      assert.equal(fs.existsSync(resource), true, `embedded CLI resource is missing from plugin JAR: ${relative}`);
      const bytes = fs.readFileSync(resource);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash, `embedded CLI resource hash mismatch: ${relative}`);
      contentDigest.update(relative, 'utf8');
      contentDigest.update('\0');
      contentDigest.update(bytes);
      contentDigest.update('\0');
    }
    assert.equal(contentDigest.digest('hex'), manifest.contentHash, 'embedded CLI aggregate content hash must match the packaged resources');
  } finally { fs.rmSync(extractDir, { recursive: true, force: true }); }
}
console.log(`ok - JetBrains plugin smoke ${zip}`);
