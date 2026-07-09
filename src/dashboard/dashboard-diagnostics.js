function diagnosticItemsForSnapshot(s = snapshot || {}){
  const items = [];
  const sources = Array.isArray(s?.sources) ? s.sources : [];
  const sourceErrors = Array.isArray(s?.sourceErrors) ? s.sourceErrors : [];
  for(const item of sourceErrors.slice(0, 3)){
    items.push({
      tone: 'warn',
      title: `${TXT.dataSourceIssue}: ${item.source || item.id || TXT.unknown}`,
      detail: item.message || item.error || TXT.openLogs,
    });
  }
  if(s?.nativeError){
    items.push({ tone: 'info', title: TXT.sqliteFallback, detail: String(s.nativeError) });
  }
  const total = Number(s?.usage?.all?.total || 0);
  const requestTotal = Number(s?.requestTotal || 0);
  const sessionTotal = Number(s?.sessionTotal || 0);
  if(!sources.length && !total && !requestTotal && !sessionTotal){
    items.push({ tone: 'warn', title: TXT.noDataSourceTitle, detail: TXT.noDataSourceHint });
  }
  const healthIssues = Array.isArray(s?.health?.issues) ? s.health.issues : [];
  for(const issue of healthIssues.filter((x) => x && x.level !== 'ok').slice(0, 2)){
    items.push({ tone: issue.level === 'danger' ? 'bad' : 'warn', title: TXT.healthIssue, detail: issue.message || issue.code || TXT.openLogs });
  }
  return items;
}
function renderDiagnosticsNotice(s = snapshot || {}, mode = 'inline'){
  const items = diagnosticItemsForSnapshot(s);
  if(!items.length) return '';
  const primary = items[0];
  const list = items.map((item) => `<li class="${esc(item.tone || 'info')}"><b>${esc(item.title)}</b><span>${esc(item.detail || '')}</span></li>`).join('');
  return `<section class="diagnostics-notice ${esc(mode)} ${esc(primary.tone || 'info')}"><div class="diagnostics-orb">i</div><div class="diagnostics-main"><div><b>${TXT.diagnosticsCenter}</b><span>${TXT.diagnosticsHint}</span></div><ul>${list}</ul></div><div class="diagnostics-actions"><button data-copy-diagnostics="1">${TXT.copyDiagnostics}</button><button data-open-logs="1">${TXT.openLogs}</button><button data-settings="1">${TXT.settings}</button></div></section>`;
}
async function copyDiagnosticsReport(){
  const base = snapshot || {};
  let diagnostics = null;
  try { diagnostics = await ipcRenderer.invoke('dashboard:getDiagnostics'); } catch {}
  const payload = {
    time: new Date().toISOString(),
    app: 'CodeArts Bar',
    timestamp: base.timestamp || null,
    updatedAt: base.updatedAt || null,
    sources: base.sources || [],
    sourceErrors: base.sourceErrors || [],
    nativeError: base.nativeError || null,
    health: base.health || null,
    usage: base.usage || null,
    requestTotal: base.requestTotal || 0,
    sessionTotal: base.sessionTotal || 0,
    diagnostics,
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  toast(TXT.diagnosticsCopied);
}
