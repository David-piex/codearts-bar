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
      localStorage.setItem('compactPane', compactPane);
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const compactPin = e.target.closest('[data-compact-pin]');
    if(compactPin){
      compactPinned = !compactPinned;
      localStorage.setItem('compactPinned', compactPinned ? '1' : '0');
      applyCompactWindowChrome();
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
    const workspace = e.target.closest('[data-workspace]');
    if(workspace){
      const nextWorkspace = workspace.dataset.workspace || 'analytics';
      const changed = workspaceMode !== nextWorkspace;
      workspaceMode = nextWorkspace;
      localStorage.setItem('workspaceMode', workspaceMode);
      if(workspaceMode === 'sessions'){ tableTab = 'sessions'; localStorage.setItem('statsTableTab', tableTab); }
      else if(tableTab === 'sessions'){ tableTab = 'requests'; localStorage.setItem('statsTableTab', tableTab); }
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
      localStorage.setItem('analyticsAdvancedOpen', analyticsAdvancedOpen ? '1' : '0');
      if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
      throw DASHBOARD_EVENT_HANDLED;
    }
  return false;
}
