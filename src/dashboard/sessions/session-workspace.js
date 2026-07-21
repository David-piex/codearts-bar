function renderSessionWorkspace(s, opts = {}){
  tableTab = 'sessions';
  persistStateNow('statsTableTab', tableTab);
  const content = sessionTable(s, opts);
  const tool = sessionBulkHtml(false);
  const count = sessionTableItems.length;
  return `<div id="sessionOverviewSlot">${sessionOverviewHtml(s)}</div><div id="sessionToolbarSlot">${sessionSimpleToolbarHtml(s)}${sessionFilterContextHtml(s)}</div><section class="table-card session-workspace-card"><div class="table-toolbar session-toolbar"><input data-query="sessions" value="${esc(sessionQuery)}" placeholder="${TXT.sessionSearch}" aria-label="${TXT.sessionSearch}" /><div id="sessionBulkSlot" class="session-bulk-slot">${tool}</div><span class="muted row-count">${n(count)} ${TXT.rows}</span></div>${content}</section><div id="sessionModalSlot">${renderRenameSheet()}${renderBulkMetaSheet()}${renderExportSheet()}</div>`;
}
function renderTable(rows, s){
  if(tableTab === 'sessions'){ tableTab = 'requests'; persistStateNow('statsTableTab', tableTab); }
  const matchedRows = tableTab === 'requests' && requestPageMatchesTable(s) ? null : applyTableSearch(rows);
  let content;
  if(tableTab === 'requests') content = tableRows(rows, s);
  else if(tableTab === 'providers') content = statTable(groupBy(matchedRows, (r) => r.provider), TXT.provider);
  else content = statTable(groupBy(matchedRows, (r) => r.model), TXT.model);
  const tabs = [['requests', TXT.reqLog], ['providers', TXT.providerStats], ['models', TXT.modelStats]];
  const count = tableTab === 'requests' && requestPageMatchesTable(s) ? Number(s.requestPage.total || s.requestPage.items.length) : matchedRows.length;
  return `<div class="table-tabs" role="tablist" aria-label="${TXT.details}">${tabs.map(([k, label]) => { const active = tableTab === k; return `<button role="tab" data-table="${k}" class="${active ? 'active' : ''}" aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}"><span class="tab-mark"></span>${esc(label)}</button>`; }).join('')}</div><section class="table-card"><div class="table-toolbar"><input data-query="analytics" value="${esc(analyticsQuery)}" placeholder="${TXT.search}" aria-label="${TXT.search}" /><span class="muted row-count">${n(count)} ${TXT.rows}</span></div>${content}</section>`;
}
