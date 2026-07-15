function renderSessionWorkspace(s, opts = {}){
  tableTab = 'sessions';
  localStorage.setItem('statsTableTab', tableTab);
  const content = sessionTable(s, opts);
  const tool = sessionBulkHtml(false);
  const count = sessionTableItems.length;
  return `<div id="sessionOverviewSlot">${sessionOverviewHtml(s)}</div><div id="sessionToolbarSlot">${sessionSimpleToolbarHtml(s)}${sessionFilterContextHtml(s)}${sessionAdvancedHtml(s)}</div><section class="table-card session-workspace-card"><div class="table-toolbar session-toolbar"><input data-query="sessions" value="${esc(sessionQuery)}" placeholder="${TXT.sessionSearch}" /><div id="sessionBulkSlot" class="session-bulk-slot">${tool}</div><span class="muted row-count">${n(count)} ${TXT.rows}</span></div>${content}</section><div id="sessionModalSlot">${renderRenameSheet()}${renderBulkMetaSheet()}${renderExportSheet()}</div>`;
}
function renderTable(rows, s){
  if(tableTab === 'sessions'){ tableTab = 'requests'; localStorage.setItem('statsTableTab', tableTab); }
  const matchedRows = tableTab === 'requests' && requestPageMatchesTable(s) ? null : applyTableSearch(rows);
  let content;
  if(tableTab === 'requests') content = tableRows(rows, s);
  else if(tableTab === 'providers') content = statTable(groupBy(matchedRows, (r) => r.provider), TXT.provider);
  else content = statTable(groupBy(matchedRows, (r) => r.model), TXT.model);
  const tabs = [['requests', TXT.reqLog], ['providers', TXT.providerStats], ['models', TXT.modelStats]];
  const count = tableTab === 'requests' && requestPageMatchesTable(s) ? Number(s.requestPage.total || s.requestPage.items.length) : matchedRows.length;
  return `<div class="table-tabs">${tabs.map(([k, label]) => `<button data-table="${k}" class="${tableTab === k ? 'active' : ''}"><span class="tab-mark"></span>${esc(label)}</button>`).join('')}</div><section class="table-card"><div class="table-toolbar"><input data-query="analytics" value="${esc(analyticsQuery)}" placeholder="${TXT.search}" /><span class="muted row-count">${n(count)} ${TXT.rows}</span></div>${content}</section>`;
}
