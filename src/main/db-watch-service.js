'use strict';

function targetFingerprint(fs, targets) {
  return targets.map((target) => {
    try {
      const st = fs.statSync(target);
      return `${target}:${st.mtimeMs}:${st.size}`;
    } catch {
      return `${target}:missing`;
    }
  }).join('|');
}

function createDbWatchService({
  fs,
  loadSettings,
  localProvider,
  dashboardWindowVisible,
  refreshLightAndPush,
  refreshTraySummaryOnly,
} = {}) {
  let dbWatchers = [];
  let dbRefreshDebounce = null;
  let watchPollTimer = null;
  let watchFingerprint = '';

  function cleanup() {
    if (watchPollTimer) {
      clearInterval(watchPollTimer);
      watchPollTimer = null;
    }
    if (dbRefreshDebounce) {
      clearTimeout(dbRefreshDebounce);
      dbRefreshDebounce = null;
    }
    for (const watcher of dbWatchers) {
      try { watcher.close(); } catch {}
    }
    dbWatchers = [];
  }

  function triggerRefreshSoon(reason = 'watch') {
    if (dbRefreshDebounce) clearTimeout(dbRefreshDebounce);
    dbRefreshDebounce = setTimeout(() => {
      if (dashboardWindowVisible?.()) refreshLightAndPush?.(reason);
      else refreshTraySummaryOnly?.();
    }, reason === 'poll' ? 450 : 700);
  }

  function schedule() {
    cleanup();
    const targets = localProvider?.watchTargets?.(loadSettings?.() || {}) || [];
    watchFingerprint = targetFingerprint(fs, targets);
    for (const target of targets) {
      try {
        if (!fs.existsSync(target)) continue;
        const watcher = fs.watch(target, { persistent: false }, () => {
          triggerRefreshSoon('fswatch');
        });
        dbWatchers.push(watcher);
      } catch {}
    }
    watchPollTimer = setInterval(() => {
      const next = targetFingerprint(fs, targets);
      if (next !== watchFingerprint) {
        watchFingerprint = next;
        triggerRefreshSoon('poll');
      }
    }, 1000);
  }

  return { cleanup, schedule, triggerRefreshSoon };
}

module.exports = { createDbWatchService, targetFingerprint };
