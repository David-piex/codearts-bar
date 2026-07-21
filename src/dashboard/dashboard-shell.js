function workspaceTabsHtml(){
  const tabs = [['analytics', TXT.analyticsWorkspace], ['sessions', TXT.sessionWorkspace]];
  return `<div class="tabs workspace-tabs" role="tablist" aria-label="\u5de5\u4f5c\u533a">${tabs.map(([k, label]) => {
    const active = workspaceMode === k;
    return `<button role="tab" data-workspace="${k}" class="tab ${active ? 'active' : ''}" aria-selected="${active ? 'true' : 'false'}" aria-keyshortcuts="Meta+${k === 'analytics' ? '1' : '2'} Control+${k === 'analytics' ? '1' : '2'}" tabindex="${active ? '0' : '-1'}">${esc(label)}</button>`;
  }).join('')}</div>`;
}
function headerToolsHtml(){
  const themeMode = window.codeartsTheme?.mode?.() || 'system';
  return `<div class="app-tools" aria-label="\u5e94\u7528\u5de5\u5177">
    <label class="toolbar-select"><span>\u89c6\u56fe</span><select id="layoutMode" data-layout-select aria-label="\u89c6\u56fe\u6a21\u5f0f"><option value="dashboard" ${layoutMode === 'dashboard' ? 'selected' : ''}>${TXT.dashboardMode}</option><option value="compact" ${layoutMode === 'compact' ? 'selected' : ''}>\u7d27\u51d1\u89c6\u56fe</option></select></label>
    <label class="toolbar-select"><span>\u5916\u89c2</span><select data-theme-mode aria-label="\u5916\u89c2"><option value="system" ${themeMode === 'system' ? 'selected' : ''}>\u81ea\u52a8</option><option value="light" ${themeMode === 'light' ? 'selected' : ''}>\u6d45\u8272</option><option value="dark" ${themeMode === 'dark' ? 'selected' : ''}>\u6df1\u8272</option></select></label>
    <button id="refresh" class="toolbar-icon" data-refresh="1" aria-label="\u5237\u65b0" aria-keyshortcuts="Meta+R Control+R" title="\u5237\u65b0"><span aria-hidden="true">&#8635;</span></button>
    <button id="settings" class="toolbar-icon" data-settings="1" aria-label="\u8bbe\u7f6e" aria-keyshortcuts="Meta+, Control+," title="\u8bbe\u7f6e"><span aria-hidden="true">&#9881;</span></button>
    <span id="refreshState" class="refresh-state" role="status" aria-live="polite" aria-atomic="true"></span>
  </div>`;
}
function headerHtml(compact = false){
  const title = compact ? TXT.compactTitle : '\u7801\u9053 Bar';
  const sub = compact ? TXT.compactHint : (workspaceMode === 'sessions' ? TXT.sessionWorkspaceHint : TXT.analyticsWorkspaceHint);
  const tabs = compact ? '' : workspaceTabsHtml();
  return `<header class="topbar app-header ${compact ? 'compact-topbar' : ''}"><div class="app-brand"><div class="logo"><img src="../assets/codearts-logo-ui.png" alt="CodeArts" width="29" height="29" decoding="async" draggable="false" /></div><div class="topbar-title"><h1 class="page-title">${title}</h1><div class="page-subtitle">${sub}</div></div></div><div class="app-header-nav">${tabs}${headerToolsHtml()}</div></header>`;
}
function filterControlsHtml(s){ return `${sourceChips(s)}${selectHtml('model', modelFilter, modelOptions(s).map((m) => [m, shortModel(m)]), TXT.allModel)}${selectHtml('project', analyticsProjectFilter, analyticsProjectOptions(s).map((item) => [item.key, item.label]), TXT.allProjects)}${refreshSelectHtml()}${rangeHtml()}`; }
function sessionFilterControlsHtml(s){ return `${sourceChips(s)}${refreshSelectHtml()}`; }
function filtersHtml(s){ if(layoutMode === 'compact') return ''; if(workspaceMode === 'sessions') return `<section class="page-head analytics-page-head session-page-head session-filter-head"><div class="head-title"><h2>${TXT.sessionWorkspace}</h2><p>${TXT.sessionWorkspaceHint}</p></div><div class="filters">${sessionFilterControlsHtml(s)}</div></section>`; return `<section class="page-head analytics-page-head"><div class="head-title"><h2>${TXT.analyticsWorkspace}</h2><p>${TXT.desc}</p></div><div class="filters">${filterControlsHtml(s)}</div></section>`; }
