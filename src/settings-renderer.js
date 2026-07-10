const ipcRenderer = window.codeartsApi;
if(!ipcRenderer || typeof ipcRenderer.invoke !== 'function') throw new Error('Settings preload API unavailable');

const ids = ['dbPath','dailyLimit','windowHours','refreshMs','showPerformance','showTools','notifyDanger'];
function el(id) { return document.getElementById(id); }
async function load() {
  const s = await ipcRenderer.invoke('settings:get');
  for (const id of ids) {
    const node = el(id);
    if (!node) continue;
    if (node.type === 'checkbox') node.checked = Boolean(s[id]);
    else node.value = s[id] ?? '';
  }
}
document.getElementById('save').onclick = async () => {
  const s = {};
  for (const id of ids) {
    const node = el(id);
    if (!node) continue;
    s[id] = node.type === 'checkbox' ? node.checked : node.value;
  }
  s.dailyLimit = Number(s.dailyLimit);
  s.windowHours = Number(s.windowHours);
  s.refreshMs = Number(s.refreshMs);
  await ipcRenderer.invoke('settings:set', s);
  el('status').textContent = '\u5df2\u4fdd\u5b58\u5e76\u5237\u65b0';
};
document.getElementById('diagnose').onclick = async () => {
  const report = await ipcRenderer.invoke('diagnose:get');
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  el('status').textContent = '\u8bca\u65ad JSON \u5df2\u590d\u5236';
};
load();
