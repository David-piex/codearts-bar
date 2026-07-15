function patchSessionInspector(){
  const started = perfNow();
  let t = started;
  const marks = { findMs: 0, commitMs: 0, selectMs: 0 };
  const slot = document.getElementById('sessionInspectorSlot');
  if(!slot) return false;
  const item = findSelectedSession();
  marks.findMs = Math.round(perfNow() - t); t = perfNow();
  if(!item){
    const html = `<aside class="session-inspector empty"><div class="inspector-title">${TXT.selectedSession}</div><p>${TXT.noSessionSelected}</p></aside>`;
    if(slotHtmlCache?.get('sessionInspectorSlot') !== html){
      try { lastCommittedHtml = ''; } catch {}
      slot.innerHTML = html;
      rememberSlotHtml('sessionInspectorSlot', html);
    }
  } else {
    selectedSessionId = sessionKeyFor(item);
    localStorage.setItem('selectedSessionId', selectedSessionId);
    if(typeof prefetchSessionRequests === 'function') prefetchSessionRequests(item, 80);
    if(!patchSessionInspectorInPlace(slot, item, selectedSessionId)){
      const html = renderSessionEssentialInspector(item, selectedSessionId);
      try { lastCommittedHtml = ''; } catch {}
      if(slotHtmlCache?.get('sessionInspectorSlot') !== html){
        slot.innerHTML = html;
        rememberSlotHtml('sessionInspectorSlot', html);
      }
    }
  }
  marks.commitMs = Math.round(perfNow() - t); t = perfNow();
  patchSessionSelectionChrome();
  marks.selectMs = Math.round(perfNow() - t);
  if(typeof recordPatchPerf === 'function') recordPatchPerf('sessions:inspector-patch', started, sessionTableItems?.length || 0, marks);
  return true;
}

function patchSessionInspectorInPlace(slot, item, key){
  const root = slot.querySelector?.('.session-essential-inspector');
  if(!root || root.classList?.contains?.('empty')) return false;
  const setText = (node, value) => { const text = String(value ?? ''); if(node && node.textContent !== text) node.textContent = text; };
  const setData = (node, name, value) => { if(node && node.dataset && node.dataset[name] !== String(value ?? '')) node.dataset[name] = String(value ?? ''); };
  const u = item.usage || {};
  const archived = Boolean(item.archived);
  const pinned = isPinnedSession(item);
  const meta = metaForSession(item);
  const title = root.querySelector('.session-essential-head h3');
  const id = root.querySelector('.session-essential-head p');
  setText(title, item.title || TXT.untitled);
  setText(id, item.id || '');
  const badges = root.querySelector('.session-badges');
  const badgeHtml = `<span class="session-state ${archived ? 'archived' : 'live'}">${archived ? TXT.archived : TXT.active}</span>${pinned ? `<span class="session-state pinned-state">${TXT.pinned}</span>` : ''}`;
  if(badges && badges.innerHTML !== badgeHtml) badges.innerHTML = badgeHtml;
  const metaValues = root.querySelectorAll('.session-essential-meta b');
  setText(metaValues[0], compact(u.total || 0));
  setText(metaValues[1], dateLabel(item.updatedAt));
  setText(metaValues[2], n(u.userTurns || 0));
  setText(metaValues[3], sessionTopModel(item));
  root.querySelectorAll('[data-session-key]').forEach((button) => { setData(button, 'sessionKey', key); });
  root.querySelectorAll('[data-session-pin]').forEach((button) => { setData(button, 'sessionPin', key); setText(button, pinned ? TXT.unpin : TXT.pin); });
  const archiveButton = root.querySelector('[data-session-action="archive"]');
  if(archiveButton){ setData(archiveButton, 'sessionKey', key); setData(archiveButton, 'archive', archived ? 'false' : 'true'); setText(archiveButton, archived ? TXT.restore : TXT.archive); }
  const tagsPreview = root.querySelector('.session-tags-preview');
  const tagsHtml = sessionTagsHtml(item, 6);
  if(tagsPreview && tagsPreview.innerHTML !== tagsHtml) tagsPreview.innerHTML = tagsHtml;
  const tags = root.querySelector('[data-session-tags]');
  if(tags){ setData(tags, 'sessionTags', key); const nextTags = (meta.tags || []).join(', '); if(tags.value !== nextTags) tags.value = nextTags; }
  const note = root.querySelector('[data-session-note]');
  if(note){ setData(note, 'sessionNote', key); const nextNote = meta.note || ''; if(note.value !== nextNote) note.value = nextNote; }
  const code = root.querySelector('.session-essential-foot code');
  if(code){ const titleText = item.directory || ''; if(code.title !== titleText) code.title = titleText; setText(code, item.directory ? compactPath(item.directory) : emptyMetric()); }
  return true;
}


function captureSessionDomState(){
  const active = document.activeElement;
  const query = active?.matches?.('[data-query="sessions"]') ? {
    start: active.selectionStart,
    end: active.selectionEnd,
  } : null;
  const scroll = document.querySelector('.session-scroll');
  const app = document.getElementById('app');
  return {
    query,
    scrollTop: Number(scroll?.scrollTop || 0),
    scrollLeft: Number(scroll?.scrollLeft || 0),
    appScrollTop: Number(app?.scrollTop || 0),
    appScrollLeft: Number(app?.scrollLeft || 0),
  };
}
function restoreSessionDomState(state = {}){
  if(state.query){
    const q = document.querySelector('[data-query="sessions"]');
    if(q){
      q.focus?.();
      try { q.setSelectionRange(state.query.start ?? q.value.length, state.query.end ?? q.value.length); } catch {}
    }
  }
  const scroll = document.querySelector('.session-scroll');
  const app = document.getElementById('app');
  const apply = () => {
    if(scroll){
      scroll.scrollTop = state.scrollTop || 0;
      scroll.scrollLeft = state.scrollLeft || 0;
    }
    if(app){
      app.scrollTop = state.appScrollTop || 0;
      app.scrollLeft = state.appScrollLeft || 0;
    }
  };
  apply();
  if(typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  setTimeout(apply, 40);
  setTimeout(apply, 120);
}
function replaceSessionTableFromHtml(managerHtml){
  const slot = document.getElementById('sessionTableSlot');
  if(!slot || !document.createElement) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = managerHtml;
  const next = tmp.querySelector?.('#sessionTableSlot');
  if(!next) return false;
  const html = next.innerHTML;
  if(slotHtmlCache?.get(slot.id) === html) return true;
  try { lastCommittedHtml = ''; } catch {}
  slot.innerHTML = html;
  rememberSlotHtml(slot.id, html);
  return true;
}
function replaceSessionInspectorFromHtml(managerHtml){
  const slot = document.getElementById('sessionInspectorSlot');
  if(!slot || !document.createElement) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = managerHtml;
  const next = tmp.querySelector?.('#sessionInspectorSlot');
  if(!next) return false;
  const html = next.innerHTML;
  try { lastCommittedHtml = ''; } catch {}
  slot.innerHTML = html;
  rememberSlotHtml(slot.id, html);
  return true;
}
function patchSessionBulk(){
  const slot = document.getElementById('sessionBulkSlot');
  if(!slot) return false;
  const selected = selectedSessionItems();
  const simple = !sessionAdvancedOpen;
  const existingSimple = simple ? slot.querySelector?.('.session-bulk.simple') : null;
  if(existingSimple){
    existingSimple.classList.toggle('empty', !selected.length);
    const label = existingSimple.querySelector('span');
    if(label) label.textContent = `${TXT.selected} ${n(selected.length)}`;
    existingSimple.querySelectorAll('button').forEach((button) => {
      const action = button?.dataset?.sessionBulk;
      if(action && action !== 'select-all') button.disabled = !selected.length;
    });
    const rowCount = document.querySelector('.session-toolbar .row-count');
    if(rowCount) rowCount.textContent = `${n(sessionTableItems.length)} ${TXT.rows}`;
    return true;
  }
  const html = sessionBulkHtml(false);
  try { lastCommittedHtml = ''; } catch {}
  slot.innerHTML = html;
  rememberSlotHtml('sessionBulkSlot', html);
  const rowCount = document.querySelector('.session-toolbar .row-count');
  if(rowCount) rowCount.textContent = `${n(sessionTableItems.length)} ${TXT.rows}`;
  return true;
}
function patchSessionOverview(s = snapshot || {}){
  return patchHtmlSlot('sessionOverviewSlot', sessionOverviewHtml(s));
}
function patchSessionToolbar(s = snapshot || {}){
  return patchHtmlSlot('sessionToolbarSlot', `${sessionSimpleToolbarHtml(s)}${sessionFilterContextHtml(s)}${sessionAdvancedHtml(s)}`);
}
function patchSessionModal(){
  return patchHtmlSlot('sessionModalSlot', `${renderRenameSheet()}${renderBulkMetaSheet()}${renderExportSheet()}`);
}
function patchSessionRow(key){
  if(typeof document.querySelectorAll !== 'function') return false;
  const item = sessionByKey(key);
  if(!item) return false;
  let patched = false;
  document.querySelectorAll('.session-row').forEach((row) => {
    if(row?.dataset?.sessionSelect !== key) return;
    const html = sessionRowHtml(item, false);
    if(row.outerHTML === html) return;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = html;
    const next = tmp.querySelector?.('.session-row');
    if(!next) return;
    row.className = next.className;
    row.innerHTML = next.innerHTML;
    patched = true;
  });
  return patched;
}
function sessionAttrSelectorValue(value){
  const raw = String(value || '');
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}
function scheduleSessionBulkPatch(){
  if(sessionBulkPatchFrame) return true;
  const token = {};
  const run = () => {
    if(sessionBulkPatchFrame !== token) return;
    sessionBulkPatchFrame = null;
    patchSessionBulk();
  };
  sessionBulkPatchFrame = token;
  if(typeof requestAnimationFrame === 'function'){
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
  setTimeout(run, 80);
  return true;
}
function patchSingleSessionCheckbox(key){
  if(!key || typeof document.querySelector !== 'function') return false;
  let patched = false;
  const input = document.querySelector(`[data-session-check="${sessionAttrSelectorValue(key)}"]`);
  if(input){
    const checked = selectedSessionKeys.has(key);
    if(input.checked !== checked) input.checked = checked;
    patched = true;
  }
  const all = sessionTableItems.map(sessionKeyFor);
  const allBox = document.querySelector('[data-session-check-all]');
  if(allBox) allBox.checked = Boolean(all.length && all.every((itemKey) => selectedSessionKeys.has(itemKey)));
  scheduleSessionBulkPatch();
  return patched || Boolean(allBox);
}
function patchSessionCheckboxes(keys = null){
  if(typeof document.querySelectorAll !== 'function') return false;
  const limit = keys instanceof Set ? keys : null;
  if(limit && limit.size === 1) return patchSingleSessionCheckbox([...limit][0]);
  const state = captureSessionDomState();
  let patched = false;
  document.querySelectorAll('[data-session-check]').forEach((input) => {
    const key = input?.dataset?.sessionCheck;
    if(!key || (limit && !limit.has(key))) return;
    const checked = selectedSessionKeys.has(key);
    if(input.checked !== checked) input.checked = checked;
    patched = true;
  });
  const all = sessionTableItems.map(sessionKeyFor);
  const allBox = document.querySelector('[data-session-check-all]');
  if(allBox) allBox.checked = Boolean(all.length && all.every((key) => selectedSessionKeys.has(key)));
  patchSessionBulk();
  restoreSessionDomState(state);
  return patched || Boolean(allBox);
}
function patchSessionVisibleRows(){
  if(!Array.isArray(sessionTableItems) || !sessionTableItems.length) return false;
  let patched = false;
  for(const item of sessionTableItems) patched = patchSessionRow(sessionKeyFor(item)) || patched;
  patchSessionBulk();
  return patched;
}
function sessionRowForKey(key){
  if(!key || typeof document.querySelector !== 'function') return null;
  try { return document.querySelector(`[data-session-select="${sessionAttrSelectorValue(key)}"]`); }
  catch { return null; }
}
function patchSessionSelectionChrome(nextRow = null){
  if(typeof document.querySelector !== 'function') return false;
  const key = selectedSessionId || '';
  if(lastSessionSelectedRowKey && lastSessionSelectedRowKey !== key){
    const prev = sessionRowForKey(lastSessionSelectedRowKey);
    if(prev?.classList?.contains?.('selected')) prev.classList.remove('selected');
  }
  document.querySelectorAll?.('.session-row.selected')?.forEach?.((row) => {
    if(row?.dataset?.sessionSelect !== key) row.classList.remove('selected');
  });
  let row = nextRow?.dataset?.sessionSelect === key ? nextRow : sessionRowForKey(key);
  if(row && !row.classList.contains('selected')) row.classList.add('selected');
  lastSessionSelectedRowKey = key;
  return Boolean(row);
}
function scheduleSessionInspectorPatch(delay = 16){
  const token = ++sessionInspectorPatchToken;
  if(sessionInspectorPatchTimer) clearTimeout(sessionInspectorPatchTimer);
  const run = () => {
    if(token !== sessionInspectorPatchToken || workspaceMode !== 'sessions') return;
    sessionInspectorPatchTimer = null;
    const commit = () => {
      if(token !== sessionInspectorPatchToken || workspaceMode !== 'sessions') return;
      patchSessionInspector();
    };
    if(typeof requestIdleCallback === 'function') requestIdleCallback(commit, { timeout: 120 });
    else if(typeof requestAnimationFrame === 'function') requestAnimationFrame(commit);
    else setTimeout(commit, 0);
  };
  sessionInspectorPatchTimer = setTimeout(run, Math.max(0, Number(delay || 0)));
  return true;
}
function patchSessionView(s = snapshot || {}, opts = {}){
  if(!document.createElement) return false;
  if(!document.getElementById('sessionOverviewSlot') || !document.getElementById('sessionTableSlot')) return false;
  const started = perfNow();
  const state = captureSessionDomState();
  const preserveScroll = opts.pageChange !== true;
  const table = opts.table !== false;
  const toolbar = opts.toolbar !== false;
  const inspector = opts.inspector !== false;
  const overview = opts.overview !== false;
  let managerHtml = '';
  if(table) managerHtml = sessionTable(s, { deferRows: opts.deferRows === true || opts.pageChange === true });
  if(overview) patchSessionOverview(s);
  if(toolbar) patchSessionToolbar(s);
  if(table) replaceSessionTableFromHtml(managerHtml);
  if(inspector){
    if(table) replaceSessionInspectorFromHtml(managerHtml);
    else patchSessionInspector();
  }
  patchSessionBulk();
  patchSessionModal();
  if(preserveScroll) restoreSessionDomState(state);
  else {
    const resetPageScroll = () => {
      const scroll = document.querySelector('.session-scroll');
      if(scroll){ scroll.scrollTop = 0; scroll.scrollLeft = 0; }
    };
    resetPageScroll();
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(resetPageScroll);
  }
  bindIncrementalTables();
  if(table && managerHtml.includes('data-session-deferred="1"') && typeof hydrateSessionRows === 'function') hydrateSessionRows();
  const domMs = perfNow() - started;
  markPerfStage('domCommitMs', domMs);
  if(!currentRenderPerf) recordPatchPerf('sessions:slots-patch', started, sessionTableItems.length, { domCommitMs: Math.round(domMs) });
  return true;
}
function patchSessionAfterLocalMutation(key, opts = {}){
  if(typeof document.querySelectorAll !== 'function') return false;
  const started = perfNow();
  const state = captureSessionDomState();
  const s = snapshot || {};
  if(opts.table) return patchSessionView(s, { table: true, toolbar: true, inspector: true });
  patchSessionOverview(s);
  patchSessionToolbar(s);
  const rowPatched = patchSessionRow(key);
  patchSessionInspector();
  patchSessionBulk();
  patchSessionModal();
  restoreSessionDomState(state);
  if(typeof recordPatchPerf === 'function'){
    recordPatchPerf('sessions:local-mutation-patch', started, sessionTableItems?.length || 0, {
      rowPatched: rowPatched ? 1 : 0,
      domCommitMs: Math.round(perfNow() - started),
    });
  }
  return true;
}
