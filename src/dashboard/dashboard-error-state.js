function dashboardErrorAdvice(message = ''){
  const text = String(message || '');
  if(/不存在|no such file|ENOENT/i.test(text)) return { title: '没有找到数据源', hint: '检查 CodeArts Agent 是否已经启动过，或在设置里选择正确的 opencode.db。', action: TXT.settings };
  if(/permission|EACCES|EPERM|权限/i.test(text)) return { title: '没有读取权限', hint: '请确认当前用户可以读取 CodeArts 数据目录，必要时以普通用户重新启动应用。', action: TXT.openLogs };
  if(/缺少 .*表|malformed|corrupt|database disk image/i.test(text)) return { title: '数据库结构异常', hint: '数据库可能损坏或版本不兼容。建议先备份数据库，再打开日志查看具体表结构错误。', action: TXT.openLogs };
  if(/CodeArts|codearts/i.test(text)) return { title: 'CodeArts 状态异常', hint: '检查 CodeArts Agent / CLI 是否安装并产生过会话数据。', action: TXT.settings };
  return { title: TXT.failed, hint: '刷新失败。你可以重试、打开设置检查数据源，或打开日志查看诊断信息。', action: TXT.openLogs };
}
function renderError(s){
  const message = esc(s?.error || TXT.noData);
  const advice = dashboardErrorAdvice(s?.error || '');
  const app = document.getElementById('app');
  commitAppHtml(app, `${headerHtml(false)}<section class="dashboard-empty-state dashboard-error-state commercial-error-state"><div class="error-orb">!</div><div><b>${esc(advice.title)}</b><span>${message}</span><em>${esc(advice.hint)}</em></div><button data-refresh="1">${TXT.refresh}</button><button data-settings="1">${TXT.settings}</button><button data-open-logs="1">${TXT.openLogs}</button></section>`);
}
