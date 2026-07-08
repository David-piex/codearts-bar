readSessionMeta();
readSavedSessionViews();
applyZoom();
document.getElementById('refresh').onclick = refreshNow;
document.getElementById('settings').onclick = () => ipcRenderer.invoke('dashboard:settings');
const legacyLayoutButton = document.getElementById('layoutMode');
if(legacyLayoutButton) legacyLayoutButton.onclick = () => switchLayoutMode(layoutMode === 'compact' ? 'dashboard' : 'compact');
document.addEventListener('keydown', async (e) => { if((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key || '').toLowerCase() === 'p'){ e.preventDefault(); togglePerfPanel(); return; } if(dateRangeOpen && e.key === 'Escape'){ dateRangeOpen = false; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true }); return; } if(e.key === 'Enter' && e.target.closest('[data-saved-session-name]')){ saveCurrentSessionView(); if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; } if(bulkMetaOpen && e.key === 'Escape'){ bulkMetaOpen = false; bulkMetaTagsDraft = ''; bulkMetaNoteDraft = ''; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); return; } if(!renameSessionKey) return; if(e.key === 'Escape'){ renameSessionKey = ''; renameDraft = ''; if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true }); } if(e.key === 'Enter' && e.target.closest('[data-rename-input]')){ await saveRenameSheet(); } });
ipcRenderer.on('dashboard:snapshot', (_e, s) => { suppressChartIntro = true; render(s, { instantChart: true, windowLayout: false, partial: true }); suppressChartIntro = false; setRefreshState(TXT.realtime); setTimeout(() => setRefreshState(''), 900); });
window.addEventListener('resize', () => {
  if(!snapshot?.ok || workspaceMode !== 'analytics' || layoutMode === 'compact') return;
  if(resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    bindChart(filterRows(snapshot), snapshot, { instant: true });
  });
});
load();
