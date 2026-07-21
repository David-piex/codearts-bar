function sessionBulkHtml(showWhenEmpty = true){
  const selected = selectedSessionItems();
  const disabled = selected.length ? '' : 'disabled';
  const simple = !showWhenEmpty;
  const exportButtons = `<button data-session-bulk="export-xlsx" ${disabled}>${TXT.exportExcel}</button><button data-session-bulk="export-md" ${disabled}>${TXT.exportMarkdownFile}</button><button data-session-bulk="export-json" ${disabled}>${TXT.exportJsonFile}</button>`;
  if(simple) return `<div class="session-bulk simple ${selected.length ? '' : 'empty'}"><span>${TXT.selected} ${n(selected.length)}</span><button data-session-bulk="clear" ${disabled}>${TXT.clearSelection}</button>${exportButtons}</div>`;
  return `<div class="session-bulk"><span>${TXT.selected} ${n(selected.length)}</span><button data-session-bulk="select-all">${TXT.selectAll}</button><button data-session-bulk="clear" ${disabled}>${TXT.clearSelection}</button><button data-session-bulk="tag" ${disabled}>${TXT.bulkTag}</button><button data-session-bulk="copy-summary" ${disabled}>${TXT.copySelected}</button>${exportButtons}<button data-session-bulk="archive" ${disabled}>${TXT.archiveSelected}</button><button data-session-bulk="restore" ${disabled}>${TXT.restoreSelected}</button></div>`;
}
function renderBulkMetaSheet(){
  if(!bulkMetaOpen) return '';
  const count = selectedSessionItems().length;
  return `<div class="modal-backdrop" data-modal-backdrop="bulk-meta"><div class="rename-sheet meta-sheet" role="dialog" aria-modal="true" aria-labelledby="bulk-meta-title" data-modal="bulk-meta"><div class="rename-head"><div><b id="bulk-meta-title">${TXT.bulkMetaTitle}</b><span>${n(count)} ${TXT.session} &#183; ${TXT.bulkMetaHint}</span></div><button data-bulk-meta-cancel="1" aria-label="${TXT.cancel}">&#215;</button></div><label>${TXT.tagsPlaceholder}<input data-bulk-meta-tags value="${esc(bulkMetaTagsDraft)}" placeholder="${TXT.tagsPlaceholder}" autofocus /></label><label>${TXT.notePlaceholder}<textarea data-bulk-meta-note placeholder="${TXT.notePlaceholder}">${esc(bulkMetaNoteDraft)}</textarea></label><div class="rename-actions"><button data-bulk-meta-cancel="1">${TXT.cancel}</button><button class="primary" data-bulk-meta-save="1">${TXT.apply}</button></div></div></div>`;
}
function renderExportSheet(){
  if(!exportDialog) return '';
  const count = exportDialog.items.length;
  return `<div class="modal-backdrop" data-modal-backdrop="export"><div class="rename-sheet export-sheet" role="dialog" aria-modal="true" aria-labelledby="export-title" data-modal="export"><div class="rename-head"><div><b id="export-title">${TXT.exportPrivacy}</b><span>${n(count)} ${TXT.session} &#183; ${esc(exportDialog.format.toUpperCase())}</span></div><button data-export-cancel="1" aria-label="${TXT.cancel}">&#215;</button></div><div class="export-options"><label><input type="checkbox" data-export-option="includeContent" checked autofocus>${TXT.includeContent}</label><label><input type="checkbox" data-export-option="includeToolIO">${TXT.includeToolIO}</label><label><input type="checkbox" data-export-option="redactPaths" checked>${TXT.redactPaths}</label><label><input type="checkbox" data-export-option="includeErrors" checked>${TXT.includeErrors}</label></div><div class="rename-actions"><button data-export-cancel="1">${TXT.cancel}</button><button class="primary" data-export-confirm="1">${TXT.confirm}</button></div></div></div>`;
}
function openExportSheet(items, format, bulk = false){
  exportDialog = { items: [...items], format, bulk };
  patchSessionModalOrRender();
}
async function confirmExportSheet(){
  if(!exportDialog) return;
  const dialog = exportDialog;
  const checked = (name) => Boolean(document.querySelector(`[data-export-option="${name}"]`)?.checked);
  const options = { includeContent: checked('includeContent'), includeToolIO: checked('includeToolIO'), redactPaths: checked('redactPaths'), includeErrors: checked('includeErrors') };
  exportDialog = null;
  patchSessionModalOrRender();
  setRefreshState(TXT.refresh);
  const channel = dialog.bulk ? 'dashboard:exportSessions' : 'dashboard:exportSession';
  const payload = dialog.bulk ? dialog.items : dialog.items[0];
  try {
    const result = await ipcRenderer.invoke(channel, payload, dialog.format, options);
    setRefreshState(result?.canceled ? '' : result?.ok === false ? (result.message || TXT.exportFailed) : TXT.actionDone);
  } catch (error) {
    setRefreshState(error?.message || TXT.exportFailed);
  }
}
function saveBulkMetaSheet(){
  const items = selectedSessionItems();
  const tags = normalizeTags(bulkMetaTagsDraft);
  const note = String(bulkMetaNoteDraft || '').trim();
  for(const item of items){
    const key = sessionKeyFor(item);
    const prev = sessionMeta[key] || { tags: [], note: '' };
    const mergedTags = [...new Set([...(prev.tags || []), ...tags])].slice(0, 12);
    const nextNote = note ? (prev.note ? `${prev.note}\n${note}` : note) : (prev.note || '');
    sessionMeta[key] = { tags: mergedTags, note: nextNote };
  }
  saveSessionMeta();
  bulkMetaOpen = false;
  bulkMetaTagsDraft = '';
  bulkMetaNoteDraft = '';
  setRefreshState(TXT.savedLocal);
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => setRefreshState(''), 900);
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
}
