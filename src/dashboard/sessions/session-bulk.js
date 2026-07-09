function sessionBulkHtml(showWhenEmpty = true){
  const selected = selectedSessionItems();
  const disabled = selected.length ? '' : 'disabled';
  const simple = !sessionAdvancedOpen && !showWhenEmpty;
  if(simple) return `<div class="session-bulk simple ${selected.length ? '' : 'empty'}"><span>${TXT.selected} ${n(selected.length)}</span><button data-session-bulk="clear" ${disabled}>${TXT.clearSelection}</button><button data-session-bulk="copy-summary" ${disabled}>${TXT.copySelected}</button><button data-session-bulk="archive" ${disabled}>${TXT.archiveSelected}</button><button data-session-bulk="restore" ${disabled}>${TXT.restoreSelected}</button></div>`;
  return `<div class="session-bulk"><span>${TXT.selected} ${n(selected.length)}</span><button data-session-bulk="select-all">${TXT.selectAll}</button><button data-session-bulk="clear" ${disabled}>${TXT.clearSelection}</button><button data-session-bulk="tag" ${disabled}>${TXT.bulkTag}</button><button data-session-bulk="copy-summary" ${disabled}>${TXT.copySelected}</button><button data-session-bulk="copy-markdown" ${disabled}>${TXT.exportMarkdown}</button><button data-session-bulk="copy-json" ${disabled}>${TXT.exportJson}</button><button data-session-bulk="copy-csv" ${disabled}>${TXT.exportCsv}</button><button data-session-bulk="archive" ${disabled}>${TXT.archiveSelected}</button><button data-session-bulk="restore" ${disabled}>${TXT.restoreSelected}</button></div>`;
}
function renderBulkMetaSheet(){
  if(!bulkMetaOpen) return '';
  const count = selectedSessionItems().length;
  return `<div class="modal-backdrop" data-modal-backdrop="bulk-meta"><div class="rename-sheet meta-sheet" role="dialog" aria-modal="true" data-modal="bulk-meta"><div class="rename-head"><div><b>${TXT.bulkMetaTitle}</b><span>${n(count)} ${TXT.session} ?${TXT.bulkMetaHint}</span></div><button data-bulk-meta-cancel="1">&#215;</button></div><label>${TXT.tagsPlaceholder}<input data-bulk-meta-tags value="${esc(bulkMetaTagsDraft)}" placeholder="${TXT.tagsPlaceholder}" /></label><label>${TXT.notePlaceholder}<textarea data-bulk-meta-note placeholder="${TXT.notePlaceholder}">${esc(bulkMetaNoteDraft)}</textarea></label><div class="rename-actions"><button data-bulk-meta-cancel="1">${TXT.cancel}</button><button class="primary" data-bulk-meta-save="1">${TXT.apply}</button></div></div></div>`;
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
