function classifyDiagnosticTone(tone = ''){
  if(tone === 'bad' || tone === 'danger' || tone === 'error') return 'bad';
  if(tone === 'warn' || tone === 'warning') return 'warn';
  return 'info';
}
function diagnosticIssueTitle(code = '', fallback = ''){
  const map = {
    database_missing: '数据库不存在',
    database_permission: '数据库权限不足',
    database_corrupt_or_schema: '数据库损坏或结构异常',
    database_locked: '数据库暂时被占用',
    database_empty_file: '数据库文件为空',
    database_no_records: '数据源暂无会话',
    codearts_not_installed: '未检测到 CodeArts 数据目录',
    sqlite_fallback: '已使用 sql.js 兼容模式',
    node_sqlite_unavailable: 'node:sqlite 不可用',
  };
  return map[code] || fallback || TXT.dataSourceIssue;
}
function classifySourceDiagnostic(item = {}){
  const message = String(item.message || item.error || item.detail || '');
  const source = item.source || item.id || TXT.unknown;
  if(/ENOENT|no such file|not found|不存在|missing/i.test(message)){
    return { tone: 'bad', code: 'database_missing', title: `数据库不存在：${source}`, detail: message || '没有找到 opencode.db。请先启动 CodeArts Agent / CLI，或在设置里选择正确路径。' };
  }
  if(/EACCES|EPERM|permission|权限|access denied/i.test(message)){
    return { tone: 'bad', code: 'database_permission', title: `数据库权限不足：${source}`, detail: message || '当前用户没有读取数据库的权限。请检查目录权限。' };
  }
  if(/malformed|corrupt|database disk image|file is not a database|缺少.*表|no such table|schema/i.test(message)){
    return { tone: 'bad', code: 'database_corrupt_or_schema', title: `数据库结构异常：${source}`, detail: message || '数据库可能损坏或版本不兼容。建议备份后查看日志。' };
  }
  if(/busy|locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)){
    return { tone: 'warn', code: 'database_locked', title: `数据库被占用：${source}`, detail: message || 'CodeArts 可能正在写入数据库，稍后刷新即可。' };
  }
  return { tone: 'warn', code: 'database_unknown', title: `${TXT.dataSourceIssue}: ${source}`, detail: message || TXT.openLogs };
}
function normalizedDiagnosticIssues(s = snapshot || {}){
  const out = [];
  const directIssues = Array.isArray(s?.diagnostics?.issues) ? s.diagnostics.issues : Array.isArray(s?.database?.diagnostics?.issues) ? s.database.diagnostics.issues : [];
  for(const item of directIssues.slice(0, 5)){
    out.push({
      tone: classifyDiagnosticTone(item.tone),
      code: item.code || '',
      title: item.title || diagnosticIssueTitle(item.code),
      detail: item.detail || item.message || item.error || '',
    });
  }
  return out;
}
function diagnosticItemsForSnapshot(s = snapshot || {}){
  const items = [];
  items.push(...normalizedDiagnosticIssues(s));
  const sources = Array.isArray(s?.sources) ? s.sources : [];
  const sourceErrors = Array.isArray(s?.sourceErrors) ? s.sourceErrors : [];
  for(const item of sourceErrors.slice(0, 3)){
    items.push(classifySourceDiagnostic(item));
  }
  if(s?.nativeError){
    items.push({ tone: 'info', code: 'sqlite_fallback', title: '已使用 sql.js 兼容模式', detail: `node:sqlite 不可用或读取失败：${String(s.nativeError)}` });
  }
  const total = Number(s?.usage?.all?.total || 0);
  const requestTotal = Number(s?.requestTotal || 0);
  const sessionTotal = Number(s?.sessionTotal || 0);
  if(!sources.length && !total && !requestTotal && !sessionTotal){
    items.push({ tone: 'warn', code: 'no_data_source', title: '没有可用数据源', detail: '没有检测到 CodeArts Agent / CLI 的 opencode.db。请先产生一次会话，或在设置里选择正确路径。' });
  }
  const healthIssues = Array.isArray(s?.health?.issues) ? s.health.issues : [];
  for(const issue of healthIssues.filter((x) => x && x.level !== 'ok').slice(0, 2)){
    items.push({ tone: issue.level === 'danger' ? 'bad' : 'warn', title: TXT.healthIssue, detail: issue.message || issue.code || TXT.openLogs });
  }
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.code || item.title}:${item.detail}`;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const sanitizeCopyText = (value = '') => String(value || '')
    .replace(/[A-Za-z]:[\\/][^\s'",;]+/g, '[path]')
    .replace(/\/(?:[^/\s'",;]+\/)+[^/\s'",;]+/g, '[path]')
    .replace(/\\\\(?:[^\\\s'",;]+\\)+[^\\\s'",;]+/g, '[path]')
    .slice(0, 300);
  const safeSource = (source = {}) => ({
    id: String(source.id || source.source || ''),
    label: String(source.label || source.id || source.source || ''),
    exists: source.exists == null ? undefined : Boolean(source.exists),
    readable: source.readable == null ? undefined : Boolean(source.readable),
    size: source.size == null ? undefined : Number(source.size || 0),
  });
  const safeIssue = (issue = {}) => ({
    tone: issue.tone || issue.level || '',
    code: issue.code || '',
    title: sanitizeCopyText(issue.title || issue.code || ''),
    detail: sanitizeCopyText(issue.detail || issue.message || issue.error || ''),
  });
  const payload = {
    time: new Date().toISOString(),
    app: 'CodeArts Bar',
    timestamp: base.timestamp || null,
    updatedAt: base.updatedAt || null,
    sources: Array.isArray(base.sources) ? base.sources.map(safeSource) : [],
    sourceErrors: Array.isArray(base.sourceErrors) ? base.sourceErrors.map(safeIssue) : [],
    nativeError: base.nativeError || null,
    health: base.health ? {
      ok: base.health.ok ?? null,
      issues: Array.isArray(base.health.issues) ? base.health.issues.map(safeIssue) : [],
    } : null,
    usage: base.usage ? {
      all: base.usage.all || null,
      bySource: base.usage.bySource || null,
    } : null,
    requestTotal: base.requestTotal || 0,
    sessionTotal: base.sessionTotal || 0,
    diagnostics: diagnostics ? {
      ok: diagnostics.ok === true,
      version: diagnostics.version || null,
      summary: diagnostics.summary || null,
    } : null,
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  toast(TXT.diagnosticsCopied);
}
