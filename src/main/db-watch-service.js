'use strict';

const { recordBestEffortFailure } = require('../core/best-effort');

function targetFingerprint(fs, targets) {
  return targets.map((target) => {
    try { const st = fs.statSync(target); return `${target}:${st.mtimeMs}:${st.size}`; }
    catch { return `${target}:missing`; }
  }).join('|');
}
function resolvePollInterval(settings = {}, visible = true) {
  const visibleMs = Math.max(1000, Math.min(60000, Number(settings.dbWatchVisiblePollMs) || 4000));
  const hiddenMs = Math.max(visibleMs, Math.min(300000, Number(settings.dbWatchHiddenPollMs) || 15000));
  return visible ? visibleMs : hiddenMs;
}

function createDbWatchService({ fs, loadSettings, localProvider, dashboardWindowVisible, refreshLightAndPush, refreshTraySummaryOnly, onDatabaseChange } = {}) {
  let dbWatchers = [];
  let dbRefreshDebounce = null;
  let watchPollTimer = null;
  let watchFingerprint = '';
  let targets = [];
  let stopped = true;

  function clearPollTimer() { if (watchPollTimer) clearTimeout(watchPollTimer); watchPollTimer = null; }
  function cleanup() {
    stopped = true;
    clearPollTimer();
    if (dbRefreshDebounce) clearTimeout(dbRefreshDebounce);
    dbRefreshDebounce = null;
    for (const watcher of dbWatchers) { try { watcher.close(); } catch (error) { recordBestEffortFailure('db-watch.close', error); } }
    dbWatchers = [];
  }
  function triggerRefreshSoon(reason = 'watch') {
    if (dbRefreshDebounce) clearTimeout(dbRefreshDebounce);
    dbRefreshDebounce = setTimeout(() => {
      if (dashboardWindowVisible?.()) refreshLightAndPush?.(reason);
      else refreshTraySummaryOnly?.();
    }, reason === 'poll' ? 450 : 700);
  }
  function handleDatabaseChange(reason) {
    const next = targetFingerprint(fs, targets);
    if (next === watchFingerprint) return false;
    watchFingerprint = next;
    try { Promise.resolve(onDatabaseChange?.(reason)).catch((error) => recordBestEffortFailure('db-watch.change', error)); }
    catch (error) { recordBestEffortFailure('db-watch.change', error); }
    triggerRefreshSoon(reason);
    return true;
  }
  function armPoll() {
    clearPollTimer();
    if (stopped) return;
    const delay = resolvePollInterval(loadSettings?.() || {}, Boolean(dashboardWindowVisible?.()));
    watchPollTimer = setTimeout(() => {
      handleDatabaseChange('poll');
      armPoll();
    }, delay);
    watchPollTimer.unref?.();
  }
  function reschedulePoll() { if (!stopped) armPoll(); }
  function schedule() {
    cleanup();
    stopped = false;
    targets = localProvider?.watchTargets?.(loadSettings?.() || {}) || [];
    watchFingerprint = targetFingerprint(fs, targets);
    for (const target of targets) {
      try {
        if (!fs.existsSync(target)) continue;
        dbWatchers.push(fs.watch(target, { persistent: false }, () => handleDatabaseChange('fswatch')));
      } catch (error) {
        recordBestEffortFailure('db-watch.subscribe', error, { targetType: 'database' });
      }
    }
    armPoll();
  }
  return { cleanup, schedule, reschedulePoll, triggerRefreshSoon };
}
module.exports = { createDbWatchService, targetFingerprint, resolvePollInterval };
