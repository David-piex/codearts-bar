async function handleDashboardChromeClick(e){
    const refreshButton = e.target.closest('[data-refresh]');
    if(refreshButton){ await refreshNow({ windowLayout: false, instantChart: true, partial: true }); throw DASHBOARD_EVENT_HANDLED; }
    const openLogs = e.target.closest('[data-open-logs]');
    if(openLogs){ await ipcRenderer.invoke('dashboard:openLogs'); throw DASHBOARD_EVENT_HANDLED; }
    const settingsButton = e.target.closest('[data-settings]');
    if(settingsButton){ await ipcRenderer.invoke('dashboard:settings'); throw DASHBOARD_EVENT_HANDLED; }
    const copyDiagnostics = e.target.closest('[data-copy-diagnostics]');
    if(copyDiagnostics){ await copyDiagnosticsReport(); throw DASHBOARD_EVENT_HANDLED; }
    const copyPerfReport = e.target.closest('[data-copy-perf-report]');
    if(copyPerfReport){ await copyPerformanceReport(); throw DASHBOARD_EVENT_HANDLED; }
    const layoutModeBtn = e.target.closest('[data-layout-mode]');
    if(layoutModeBtn){
      switchLayoutMode(layoutModeBtn.dataset.layoutMode);
      throw DASHBOARD_EVENT_HANDLED;
    }
    const compactPaneBtn = e.target.closest('[data-compact-pane]');
    if(compactPaneBtn){
      compactPane = compactPaneBtn.dataset.compactPane || 'overview';
      persistStateNow('compactPane', compactPane);
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const compactPin = e.target.closest('[data-compact-pin]');
    if(compactPin){
      compactPinned = !compactPinned;
      persistStateNow('compactPinned', compactPinned ? '1' : '0');
      applyCompactWindowChrome();
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const workspace = e.target.closest('[data-workspace]');
    if(workspace){
      const nextWorkspace = workspace.dataset.workspace || 'analytics';
      const changed = workspaceMode !== nextWorkspace;
      workspaceMode = nextWorkspace;
      persistStateNow('workspaceMode', workspaceMode);
      if(workspaceMode === 'sessions'){ tableTab = 'sessions'; persistStateNow('statsTableTab', tableTab); }
      else if(tableTab === 'sessions'){ tableTab = 'requests'; persistStateNow('statsTableTab', tableTab); }
      if(changed){
        document.getElementById('app')?.classList?.add?.('view-switching');
        setAppInteractionMode('view-switching', 200);
      }
      const canDeferWorkspace = workspaceMode === 'analytics' && changed && typeof ResizeObserver !== 'undefined';
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true, deferHeavy: canDeferWorkspace });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const analyticsAdvancedToggle = e.target.closest('[data-analytics-advanced-toggle]');
    if(analyticsAdvancedToggle){
      analyticsAdvancedOpen = !analyticsAdvancedOpen;
      persistStateNow('analyticsAdvancedOpen', analyticsAdvancedOpen ? '1' : '0');
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
  return false;
}

document.addEventListener('change', (e) => {
  const layout = e.target.closest?.('[data-layout-select]');
  if(layout){
    switchLayoutMode(layout.value);
    return;
  }
  const theme = e.target.closest?.('[data-theme-mode]');
  if(theme){
    window.codeartsTheme?.set?.(theme.value);
  }
});

document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('[role="tablist"] [role="tab"]');
  if(!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  if(!tabs.length) return;
  e.preventDefault();
  const current = Math.max(0, tabs.indexOf(tab));
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus?.();
  tabs[next]?.click?.();
});
