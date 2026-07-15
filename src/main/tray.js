'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Menu, nativeImage } = require('electron');

function colorForLevel(level) {
  return level === 'danger' ? '#ff4d4f' : level === 'warning' ? '#faad14' : '#16a34a';
}

function makeTrayIcon(snapshot, options = {}) {
  const size = process.platform === 'win32' ? 32 : 22;
  const assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'assets');
  const logoPath = path.join(assetsDir, process.platform === 'win32' ? 'codearts-logo.ico' : 'codearts-tray.png');
  try {
    if (fs.existsSync(logoPath)) {
      const logo = nativeImage.createFromPath(logoPath);
      if (!logo.isEmpty()) return logo.resize({ width: size, height: size });
    }
  } catch {}
  const percent = snapshot && snapshot.ok ? Math.min(100, Math.max(0, snapshot.status.usagePercent || 0)) : 0;
  const label = snapshot && snapshot.ok ? String(Math.round(percent)).padStart(percent >= 100 ? 3 : 2, ' ') : '!';
  const fg = snapshot && snapshot.ok ? colorForLevel(snapshot.status.level) : '#ff4d4f';
  const bg = '#101828';
  const barHeight = Math.max(2, Math.round((percent / 100) * (size - 6)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="7" fill="${bg}"/><rect x="4" y="${size - 4 - barHeight}" width="${size - 8}" height="${barHeight}" rx="2" fill="${fg}" opacity="0.9"/><text x="50%" y="${size <= 22 ? 14 : 19}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="${size <= 22 ? 8 : 11}" font-weight="700" fill="#fff">${label}</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function menuItem(label, sublabel) {
  return { label: sublabel ? `${label}    ${sublabel}` : label, enabled: false };
}

function trim(text, max) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function traySummaryText(snapshot, fmtInt) {
  if (!snapshot || !snapshot.ok) return snapshot ? `码道 Bar\n${snapshot.error}` : '码道 Bar';
  const u = snapshot.usage || {};
  return [
    `码道 Bar · 今日软上限 ${snapshot.status?.label || '0%'}`,
    `更新：${snapshot.updatedAt || '未刷新'}`,
    `今日：${fmtInt(u.today?.total || 0)} token`,
    `24h：${fmtInt(u.window?.total || 0)} token`,
    `7d：${fmtInt(u.week?.total || 0)} token`,
  ].join('\n');
}

function buildTrayMenu(snapshot, options = {}) {
  const fmtInt = options.fmtInt || ((value) => String(value || 0));
  const actions = options.actions || {};
  if (!snapshot || !snapshot.ok) {
    return Menu.buildFromTemplate([
      { label: '码道 Bar', enabled: false },
      { type: 'separator' },
      { label: trim(snapshot ? snapshot.error : '尚未刷新', 120), enabled: false },
      { type: 'separator' },
      { label: '打开面板', click: actions.openDashboardWindow },
      { label: '刷新', click: actions.refreshTraySummaryOnly },
      { label: '打开日志', click: actions.openLogFile },
      { type: 'separator' },
      { label: '退出', click: actions.quitApp },
    ]);
  }
  const u = snapshot.usage || {};
  const template = [
    { label: '码道 Bar', enabled: false },
    { label: `更新：${snapshot.updatedAt || '未刷新'}`, enabled: false },
    { type: 'separator' },
    menuItem('今日 Token', `${fmtInt(u.today?.total || 0)} · ${u.today?.messages || 0} 回复 · ${u.today?.errors || 0} 错误`),
    menuItem('24h Token', fmtInt(u.window?.total || 0)),
    menuItem('7d Token', fmtInt(u.week?.total || 0)),
    menuItem('历史 Token', fmtInt(u.all?.total || 0)),
  ];
  template.push({ type: 'separator' });
  template.push({ label: '打开面板', click: actions.openDashboardWindow });
  template.push({ label: '刷新', click: actions.refreshTraySummaryOnly });
  template.push({ label: '设置', click: actions.openSettingsWindow });
  template.push({ label: '打开日志', click: actions.openLogFile });
  template.push({ label: '检查更新 / 安装包', click: actions.openReleaseFolder });
  template.push({ label: '打开码道', click: () => actions.openCodeArts?.() });
  template.push({ type: 'separator' });
  template.push({ label: '退出', click: actions.quitApp });
  return Menu.buildFromTemplate(template);
}

function updateTray(tray, snapshot, options = {}) {
  if (!tray) return;
  tray.setImage(makeTrayIcon(snapshot, options));
  tray.setToolTip(snapshot?.ok ? traySummaryText(snapshot, options.fmtInt) : `码道 Bar\n${snapshot?.error || '尚未刷新'}`);
  tray.setContextMenu(buildTrayMenu(snapshot, options));
}

function refreshTrayMenu(tray, snapshot, options = {}) {
  if (!tray) return null;
  const menu = buildTrayMenu(snapshot, options);
  tray.setContextMenu(menu);
  return menu;
}

function showTrayMenu(tray, snapshot, options = {}) {
  if (!tray) return;
  const menu = refreshTrayMenu(tray, snapshot, options);
  try { tray.popUpContextMenu(menu || undefined); } catch { tray.popUpContextMenu(); }
}

module.exports = {
  colorForLevel,
  makeTrayIcon,
  traySummaryText,
  buildTrayMenu,
  updateTray,
  refreshTrayMenu,
  showTrayMenu,
};
