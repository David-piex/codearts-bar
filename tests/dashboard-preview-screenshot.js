"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist", "screenshots");
const previewPath = path.join(outDir, "preview.html");
const screenshotPath = path.join(outDir, "session-manager-cache-governance.png");
const analyticsPreviewPath = path.join(outDir, "analytics-chart-preview.html");
const analyticsScreenshotPath = path.join(outDir, "analytics-chart-cache-heatline.png");
const analyticsTotalPreviewPath = path.join(outDir, "analytics-total-overview.html");
const analyticsTotalScreenshotPath = path.join(outDir, "analytics-total-overview.png");
const analyticsHoverPreviewPath = path.join(outDir, "analytics-chart-hover-preview.html");
const analyticsHoverScreenshotPath = path.join(outDir, "analytics-chart-hover-pinned.png");
const analyticsDatePreviewPath = path.join(outDir, "analytics-date-range-preview.html");
const analyticsDateScreenshotPath = path.join(outDir, "analytics-date-range-popover.png");

function fileUrl(filePath) { return `file:///${filePath.replace(/\\/g, "/")}`; }
function findChrome() {
  return [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((x) => fs.existsSync(x));
}
function makeElement(id) {
  const ctx = { scale(){}, clearRect(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, stroke(){}, fill(){}, fillText(){}, closePath(){}, save(){}, restore(){}, setLineDash(){}, arc(){}, roundRect(){}, measureText(text){ return { width: String(text || "").length * 7 }; }, createLinearGradient(){ return { addColorStop(){} }; }, createRadialGradient(){ return { addColorStop(){} }; } };
  return { id, innerHTML: "", textContent: "", style: {}, classList: { add(){}, remove(){}, toggle(){} }, closest(){ return null; }, focus(){}, select(){}, setSelectionRange(){}, getBoundingClientRect(){ return { left: 0, top: 0, width: 1280, height: 860 }; }, getContext(){ return ctx; } };
}
function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem(k){ return data.has(k) ? data.get(k) : null; }, setItem(k,v){ data.set(k, String(v)); }, removeItem(k){ data.delete(k); } };
}
const now = Date.UTC(2026, 6, 8, 2, 50, 0), H = 3600000;
function req(id, sessionId, title, source, model, ago, input, output, cacheRead, cacheWrite, latencyMs, ttftMs, speed){ return { id, sessionId, sessionTitle:title, source, sourceLabel: source === "cli" ? "CLI" : "桌面端", provider:"codearts", model, time: now - ago * H, input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, ok:true, status:"200", latencyMs, ttftMs, firstContentMs: ttftMs + 80, outputTokensPerSec:speed }; }
const requestLog = [
  req("r1", "s-alpha", "CodexBar 原生质感打磨", "desktop", "GLM-5.1", 1, 1800, 1100, 9800, 900, 1480, 320, 28),
  req("r2", "s-alpha", "CodexBar 原生质感打磨", "desktop", "GLM-5.1", 2, 1600, 900, 7200, 780, 1320, 280, 32),
  req("r3", "s-beta", "缓存命中率排查", "cli", "gpt-5.5", 4, 2600, 1900, 180, 1250, 4200, 620, 18),
  req("r4", "s-beta", "缓存命中率排查", "cli", "gpt-5.5", 5, 2200, 1600, 120, 1100, 3800, 540, 20),
  req("r5", "s-gamma", "Agent idle analysis", "desktop", "deepseek-v4-flash", 8, 900, 760, 2400, 360, 1160, 260, 36),
  req("r6", "s-delta", "会话归档整理", "cli", "GLM-5.1", 13, 1300, 720, 80, 640, 6100, 760, 14),
  req("r7", "s-epsilon", "长线项目工作台", "desktop", "GLM-5.1", 18, 1500, 880, 5400, 720, 1700, 310, 30),
];
function usageFor(id){ const rows = requestLog.filter((x) => x.sessionId === id); const u = rows.reduce((a,x) => { a.total += x.total; a.input += x.input; a.output += x.output; a.cacheRead += x.cacheRead; a.cacheWrite += x.cacheWrite; a.modelCalls += 1; return a; }, { total:0, input:0, output:0, cacheRead:0, cacheWrite:0, userTurns: rows.length + 1, modelCalls:0 }); const byModel = new Map(); for(const x of rows){ const k = `${x.provider}:${x.model}`; const m = byModel.get(k) || { provider:x.provider, model:x.model, calls:0, total:0, input:0, output:0, cacheRead:0, cacheWrite:0 }; m.calls += 1; m.total += x.total; m.input += x.input; m.output += x.output; m.cacheRead += x.cacheRead; m.cacheWrite += x.cacheWrite; byModel.set(k, m); } u.models = [...byModel.values()]; u.topModel = u.models[0]; return u; }
function session(id,title,directory,source,ago){ return { id, title, directory, version:"1", createdAt: now - (ago + 12) * H, updatedAt: now - ago * H, archived:false, source, sourceLabel: source === "cli" ? "CLI" : "桌面端", dbPath:"preview", usage: usageFor(id) }; }
const sessions = [session("s-alpha", "CodexBar 原生质感打磨", "C:/work/codearts-bar", "desktop", 1), session("s-beta", "缓存命中率排查", "C:/work/cache-lab", "cli", 4), session("s-gamma", "Agent idle analysis", "C:/work/ops", "desktop", 8), session("s-delta", "会话归档整理", "C:/work/client-a", "cli", 13), session("s-epsilon", "长线项目工作台", "C:/work/client-a", "desktop", 18)];
const usage = requestLog.reduce((a,x) => { a.total += x.total; a.input += x.input; a.output += x.output; a.cacheRead += x.cacheRead; a.cacheWrite += x.cacheWrite; a.requests += 1; return a; }, { total:0, input:0, output:0, cacheRead:0, cacheWrite:0, requests:0 });
const snapshot = { ok:true, timestamp:now, updatedAt:"2026/07/08 10:50", dbPath:"preview", sources:[{ id:"desktop", source:"desktop", label:"桌面端" }, { id:"cli", source:"cli", label:"CLI" }], usage:{ today:usage, window:usage, week:usage, all:usage }, queue:{ window:{ samples:4, avg:1600, max:4200 }, trends:{ hourly24h:[] } }, requestLog, sessions, status:{ usagePercent:42, level:"ok", label:"42%" } };
async function renderAppHtml(workspaceMode = "sessions", options = {}){
  const elements = new Map();
  for(const id of ["app", "refresh", "settings", "layoutMode", "zoomIn", "zoomOut", "copy", "refreshState", "chartTip"]) elements.set(id, makeElement(id));
  const listeners = {};
  const document = { body:{ style:{} }, getElementById(id){ if(!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); }, addEventListener(type, fn){ listeners[type] = fn; }, querySelector(){ return null; }, querySelectorAll(){ return []; } };
  const ipcRenderer = { async invoke(){ return snapshot; }, on(){} };
  const storage = makeStorage({ workspaceMode, statsTableTab: workspaceMode === "sessions" ? "sessions" : "requests", sessionQuickFilter:"all", sessionProjectFilter:"all", sessionStatusFilter:"active", sessionSort:"updated", statsSource:"all", statsRange:"1d", layoutMode:"dashboard", uiZoom:"0.92", chartSeries:"total,input,output,cacheHitRate" });
  let rafNow = 0;
  const context = { console, require(name){ if(name === "electron") return { ipcRenderer }; if(name === "node:fs") return require("node:fs"); if(name === "node:path") return require("node:path"); throw new Error(`Unexpected require: ${name}`); }, window:{ matchMedia:() => ({ matches:false }), devicePixelRatio:1, innerWidth:1280, innerHeight:860, addEventListener(){} }, document, localStorage: storage, navigator:{ clipboard:{ writeText: async () => {} } }, setInterval(){ return 1; }, clearInterval(){}, setTimeout(fn){ if(typeof fn === "function") fn(); return 1; }, clearTimeout(){}, requestAnimationFrame(fn){ rafNow += 120; if(typeof fn === "function") fn(rafNow); return rafNow; }, cancelAnimationFrame(){}, performance:{ now:() => rafNow }, Date, Intl, Math, Number, String, Boolean, JSON, Map, Set, Array, Object, RegExp, Error, Promise };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "src", "dashboard-renderer.js"), "utf8"), context, { filename:"dashboard-renderer.js" });
  for(let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
  if(options.openDateRange && listeners.click){
    await listeners.click({ target:{ closest(selector){ if(selector === ".date-range-control") return { className:"date-range-control" }; if(selector === "[data-date-range-toggle]") return { dataset:{ dateRangeToggle:"1" } }; return null; } } });
    for(let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
  return elements.get("app").innerHTML;
}
function inlineAnalyticsChartScript(options = {}) {
  const payload = JSON.stringify({ now, requestLog });
  const opts = JSON.stringify(options);
  return `<script>
(() => {
  const data = ${payload};
  const previewOptions = ${opts};
  const fmt = new Intl.NumberFormat('zh-CN');
  const H = 3600000;
  function n(v){ return fmt.format(Math.round(Number(v) || 0)); }
  function pct(read, write, input = 0){ const total = read + write + input; return total > 0 ? (read / total) * 100 : 0; }
  function colorFor(hit){ return hit >= 60 ? '#08a045' : hit >= 25 ? '#f59e0b' : '#ef3b55'; }
  function drawHoverAperture(ctx, focusX, focusY, pad, w, h, tone){
    ctx.save();
    const beamW = 42;
    const guide = ctx.createLinearGradient(focusX - beamW / 2, 0, focusX + beamW / 2, 0);
    guide.addColorStop(0, 'rgba(22,135,245,0)');
    guide.addColorStop(.5, 'rgba(22,135,245,.115)');
    guide.addColorStop(1, 'rgba(22,135,245,0)');
    ctx.fillStyle = guide;
    ctx.fillRect(focusX - beamW / 2, pad.t, beamW, h);
    ctx.strokeStyle = 'rgba(10,132,255,.54)';
    ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(focusX, pad.t); ctx.lineTo(focusX, pad.t + h); ctx.stroke();
    ctx.strokeStyle = 'rgba(244,63,94,.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(pad.l, focusY); ctx.lineTo(pad.l + w, focusY); ctx.stroke();
    ctx.setLineDash([]);
    const halo = ctx.createRadialGradient(focusX, focusY, 0, focusX, focusY, 42);
    halo.addColorStop(0, 'rgba(244,63,94,.24)');
    halo.addColorStop(.48, 'rgba(244,63,94,.12)');
    halo.addColorStop(1, 'rgba(244,63,94,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(focusX, focusY, 42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = tone || 'rgba(10,132,255,.30)';
    ctx.beginPath(); ctx.arc(focusX, focusY, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function drawCacheLens(ctx, focus, pad, w, h, focusX){
    const hit = pct(focus.cacheRead, focus.cacheWrite, focus.input);
    const tone = colorFor(hit);
    const boxW = 164;
    const boxH = 46;
    const x = Math.max(pad.l + 8, Math.min(pad.l + w - boxW - 8, focusX - boxW / 2));
    const y = Math.max(pad.t + 12, pad.t + h - 66);
    const ringX = x + 22;
    const ringY = y + 23;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,.12)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    const glass = ctx.createLinearGradient(0, y, 0, y + boxH);
    glass.addColorStop(0, 'rgba(255,255,255,.94)');
    glass.addColorStop(1, 'rgba(247,251,255,.74)');
    ctx.fillStyle = glass;
    ctx.strokeStyle = 'rgba(10,132,255,.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 15);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226,232,240,.92)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(ringX, ringY, 11, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = tone;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(ringX, ringY, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (hit / 100));
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#172033';
    ctx.font = '800 12px Segoe UI, Microsoft YaHei UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(hit) + '%', x + 43, y + 18);
    ctx.fillStyle = 'rgba(100,116,139,.88)';
    ctx.font = '10px Segoe UI, Microsoft YaHei UI, sans-serif';
    ctx.fillText('\u547d\u4e2d / \u521b\u5efa', x + 43, y + 32);
    ctx.fillStyle = 'rgba(226,232,240,.92)';
    ctx.beginPath();
    ctx.roundRect(x + 43, y + 36, 86, 4, 2);
    ctx.fill();
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.roundRect(x + 43, y + 36, Math.max(4, 86 * hit / 100), 4, 2);
    ctx.fill();
    ctx.fillStyle = tone;
    ctx.font = '900 10px Segoe UI, Microsoft YaHei UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(hit >= 60 ? '\u9ad8\u590d\u7528' : hit >= 25 ? '\u6709\u590d\u7528' : '\u5f85\u63d0\u5347', x + boxW - 12, y + 18);
    ctx.restore();
  }
  function draw(){
    const canvas = document.getElementById('usageChart');
    if(!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const pad = { l: 58, r: 28, t: 18, b: 36 };
    const w = rect.width - pad.l - pad.r;
    const h = rect.height - pad.t - pad.b;
    const end = Math.ceil(data.now / H) * H;
    const start = end - 23 * H;
    const buckets = Array.from({ length: 24 }, (_, i) => ({ start: start + i * H, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }));
    for(const r of data.requestLog){
      const t = Math.floor(r.time / H) * H;
      const b = buckets.find((x) => x.start === t);
      if(!b) continue;
      b.total += r.total || 0;
      b.input += r.input || 0;
      b.output += r.output || 0;
      b.cacheRead += r.cacheRead || 0;
      b.cacheWrite += r.cacheWrite || 0;
      b.requests += 1;
    }
    ctx.clearRect(0, 0, rect.width, rect.height);
    const bg = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    bg.addColorStop(0, 'rgba(22,135,245,.045)');
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(pad.l, pad.t, w, h);
    ctx.strokeStyle = 'rgba(149,164,184,.18)';
    ctx.fillStyle = '#7b8190';
    ctx.font = '12px Segoe UI, Microsoft YaHei UI, sans-serif';
    for(let i = 0; i <= 4; i++){
      const y = pad.t + h * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
      ctx.fillText(String(Math.round((1 - i / 4) * 100)) + '%', 8, y + 4);
    }
    const max = Math.max(1, ...buckets.map((b) => b.total));
    const bw = Math.max(5, Math.min(18, (w / buckets.length) * .56));
    const bar = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    bar.addColorStop(0, 'rgba(10,132,255,.20)');
    bar.addColorStop(1, 'rgba(10,132,255,.04)');
    buckets.forEach((b, i) => {
      const x = pad.l + (i * w / Math.max(1, buckets.length - 1));
      const bh = (b.total / max) * h;
      if(bh > 0){
        ctx.fillStyle = bar;
        ctx.beginPath();
        ctx.roundRect(x - bw / 2, pad.t + h - bh, bw, bh, 5);
        ctx.fill();
      }
    });
    function line(key, color){
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = key === 'total' ? 2.35 : 1.85;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      buckets.forEach((b, i) => {
        const x = pad.l + (i * w / Math.max(1, buckets.length - 1));
        const y = pad.t + h - ((Number(b[key]) || 0) / max) * h;
        if(i === 0) ctx.moveTo(x, y); else {
          const prevX = pad.l + ((i - 1) * w / Math.max(1, buckets.length - 1));
          const prevY = pad.t + h - ((Number(buckets[i - 1][key]) || 0) / max) * h;
          ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
        }
      });
      ctx.stroke();
      ctx.restore();
    }
    line('total', '#f43f5e');
    line('input', '#2f7df6');
    line('output', '#16b862');
    const cacheY = pad.t + h - 7;
    buckets.forEach((b, i) => {
      const cacheTotal = b.cacheRead + b.cacheWrite;
      if(!cacheTotal) return;
      const x = pad.l + (i * w / Math.max(1, buckets.length - 1));
      const hit = pct(b.cacheRead, b.cacheWrite, b.input);
      ctx.globalAlpha = .38 + hit / 100 * .38;
      ctx.fillStyle = colorFor(hit);
      ctx.beginPath();
      ctx.roundRect(x - 9, cacheY - 2.5, 18, 5, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = 'rgba(100,116,139,.72)';
    ctx.textAlign = 'right';
    ctx.fillText('缓存热度', pad.l + w, pad.t + h - 13);
    const hot = buckets.filter((b) => b.cacheRead + b.cacheWrite > 0).reduce((acc, b) => ({ cacheRead: acc.cacheRead + b.cacheRead, cacheWrite: acc.cacheWrite + b.cacheWrite, input: acc.input + b.input, total: acc.total + b.total, requests: acc.requests + b.requests }), { cacheRead: 0, cacheWrite: 0, input: 0, total: 0, requests: 0 });
    const focusIndex = buckets.reduce((best, b, i) => b.total > buckets[best].total ? i : best, 0);
    const focus = buckets[focusIndex];
    const focusX = pad.l + (focusIndex * w / Math.max(1, buckets.length - 1));
    const focusY = pad.t + h - (focus.total / max) * h;
    if(previewOptions.pinnedHover){
      const card = document.querySelector('.chart-card');
      card?.classList.add('chart-active', 'chart-pinned', 'chart-hover-preview');
      drawHoverAperture(ctx, focusX, focusY, pad, w, h, 'rgba(10,132,255,.30)');
      drawCacheLens(ctx, focus, pad, w, h, focusX);
      ctx.fillStyle = '#0a84ff';
      ctx.beginPath(); ctx.arc(focusX, focusY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(10,132,255,.94)';
      ctx.beginPath(); ctx.roundRect(Math.max(pad.l + 4, Math.min(pad.l + w - 56, focusX - 28)), pad.t + 6, 56, 22, 11); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '11px Segoe UI, Microsoft YaHei UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('\u5df2\u56fa\u5b9a', Math.max(pad.l + 32, Math.min(pad.l + w - 28, focusX)), pad.t + 21);
      const tip = document.getElementById('chartTip');
      if(tip){
        tip.innerHTML = '<b>07/08 09:50</b><div class="tip-row tip-state"><span>\u6d3b\u8dc3\u65f6\u6bb5</span><strong>' + n(focus.requests) + ' \u8bf7\u6c42</strong></div><div class="tip-pin">\u5df2\u56fa\u5b9a\u70b9\u4f4d \u00b7 \u53cc\u51fb\u53d6\u6d88\u56fa\u5b9a</div><div class="tip-row hot"><span style="--c:#f43f5e">\u603b token</span><strong>' + n(focus.total) + '</strong></div><div class="tip-row"><span style="--c:#2f7df6">\u8f93\u5165</span><strong>' + n(focus.input) + '</strong></div><div class="tip-row"><span style="--c:#16b862">\u8f93\u51fa</span><strong>' + n(focus.output) + '</strong></div><div class="tip-divider"></div><div class="tip-row tip-state"><span>\u7f13\u5b58\u547d\u4e2d\u7387</span><strong>' + Math.round(pct(focus.cacheRead, focus.cacheWrite, focus.input)) + '%</strong></div><div class="tip-cache-bar" style="--hit:' + Math.round(pct(focus.cacheRead, focus.cacheWrite, focus.input)) + '%"><i></i></div><div class="tip-row tip-metric cache-health hot"><span>\u7f13\u5b58\u4f53\u611f</span><strong>\u9ad8\u590d\u7528</strong></div>';
        tip.classList.add('show', 'preview-pinned');
        tip.style.transform = 'translate3d(868px, 315px, 0) scale(1)';
      }
    }
    const meta = document.getElementById('chartHoverMeta');
    if(meta) meta.innerHTML = previewOptions.pinnedHover
      ? '<b>07/08 09:50</b><span>\u5df2\u56fa\u5b9a\u70b9\u4f4d</span><span>\u8bf7\u6c42 ' + n(focus.requests) + '</span><span>\u603b token ' + n(focus.total) + '</span><span class="cache-meta">\u7f13\u5b58\u547d\u4e2d\u7387 ' + Math.round(pct(focus.cacheRead, focus.cacheWrite, focus.input)) + '%</span><span class="cache-health-meta hot">\u7f13\u5b58\u4f53\u611f \u9ad8\u590d\u7528</span><span>hover aperture \u5df2\u7ed8\u5236</span><span>cache lens \u5df2\u7ed8\u5236</span><span>hover tooltip \u5df2\u7ed8\u5236</span><span>hover focus rail \u5df2\u7ed8\u5236</span>'
      : '<b>\u56fe\u8868\u9884\u89c8</b><span>\u8bf7\u6c42 ' + n(hot.requests) + '</span><span>\u603b token ' + n(hot.total) + '</span><span>\u7f13\u5b58\u547d\u4e2d\u7387 ' + Math.round(pct(hot.cacheRead, hot.cacheWrite, hot.input)) + '%</span><span>\u7f13\u5b58\u70ed\u5ea6\u5df2\u7ed8\u5236</span>';
    const scrubber = document.getElementById('chartHoverScrubber');
    if(scrubber){
      const activeBucket = previewOptions.pinnedHover ? focus : hot;
      const activeHit = Math.round(pct(activeBucket.cacheRead, activeBucket.cacheWrite, activeBucket.input));
      scrubber.classList.toggle('active', Boolean(previewOptions.pinnedHover));
      scrubber.classList.toggle('pinned', Boolean(previewOptions.pinnedHover));
      scrubber.innerHTML = previewOptions.pinnedHover
        ? '<b>07/08 09:50</b><span class="scrubber-pin">\u5df2\u56fa\u5b9a\u70b9\u4f4d</span><span>\u8bf7\u6c42 ' + n(activeBucket.requests) + '</span><span>\u603b token ' + n(activeBucket.total) + '</span><span class="scrubber-focus">\u603b token ' + n(activeBucket.total) + '</span><span class="scrubber-cache hot">\u7f13\u5b58\u547d\u4e2d\u7387 ' + activeHit + '% \u00b7 \u9ad8\u590d\u7528</span><i class="hot" style="--hit:' + activeHit + '%"><em></em></i>'
        : '<b>\u56fe\u8868\u56fe\u4f8b</b><span>\u79fb\u5230\u56fe\u8868\u4e0a\u67e5\u770b\u6570\u503c\uff0c\u70b9\u51fb\u53ef\u56fa\u5b9a</span><span>\u7f13\u5b58\u70ed\u5ea6</span><i style="--hit:0%"><em></em></i>';
    }
  }
  window.addEventListener('load', draw);
  setTimeout(draw, 80);
})();
</script>`;
}
function buildPreviewHtml(baseHtml, appHtml, options = {}) {
  let html = baseHtml.replace(/<main id="app" class="content">[\s\S]*?<\/main>/, `<main id="app" class="content">${appHtml}</main>`).replace('<script src="dashboard-renderer.js"></script>', '');
  if(options.analyticsChart){
    html = html.replace('</head>', `<style>
      .summary-card,.agent-rhythm-card,.source-overview,.cache-insights{display:none!important}
      .topbar{margin-bottom:8px!important}
      .workspace-tabs{margin-bottom:10px!important}
      .page-head{margin-bottom:8px!important}
      .head-title h2,.head-title p{display:none!important}
      .filters{margin-left:auto!important}
      .chart-card{margin-top:0!important;padding:16px 20px 12px!important}
      .chart-snapshot{display:none!important}
      .chart-scale-note{margin:0 0 8px!important}
      .card-head{margin-bottom:8px!important}
      .chart-wrap{height:430px!important}
      .chart-underbar{margin-top:8px!important}
      .chart-hover-preview .chart-wrap{border-color:rgba(10,132,255,.42)!important;box-shadow:0 0 0 3px rgba(10,132,255,.07) inset,0 14px 30px rgba(10,132,255,.055)!important}
      .chart-tip.preview-pinned{display:block!important}
    </style></head>`);
    html = html.replace('</body>', `${inlineAnalyticsChartScript({ pinnedHover: Boolean(options.pinnedHover) })}</body>`);
  }
  if(options.analyticsTotal){
    html = html.replace('</head>', `<style>
      .usage-detail-stack,.agent-rhythm-card,.source-overview,.cache-insights,.table-tabs,.table-card{display:none!important}
      .topbar{margin-bottom:8px!important}
      .workspace-tabs{margin-bottom:10px!important}
      .page-head{margin-bottom:10px!important}
      .usage-summary{padding:18px 18px 4px!important;margin-top:0!important}
      .usage-total-board{margin:0!important}
      .chart-card{margin:12px 18px 0!important;padding:14px 18px 12px!important}
      .chart-snapshot{display:none!important}
      .chart-scale-note{margin:0 0 8px!important}
      .card-head{margin-bottom:8px!important}
      .chart-wrap{height:300px!important}
      .chart-underbar{margin-top:8px!important}
    </style></head>`);
    html = html.replace('</body>', `${inlineAnalyticsChartScript()}</body>`);
  }
  return html;
}
function assertPreviewHtml(label, html){
  const cp = (...codes) => String.fromCharCode(...codes);
  const pinnedPoint = cp(0x5df2, 0x56fa, 0x5b9a, 0x70b9, 0x4f4d);
  const cacheHitRateText = cp(0x7f13, 0x5b58, 0x547d, 0x4e2d, 0x7387);
  const hoverDrawn = `hover tooltip ${cp(0x5df2, 0x7ed8, 0x5236)}`;
  const badMarkers = ["???", "\uFFFD", "\u7523\u8d0b"];
  for(const marker of badMarkers){
    if(html.includes(marker)) throw new Error(`${label} preview contains mojibake marker: ${marker}`);
  }
  if(label === "analytics hover"){
    const groups = [
      ["chart-hover-preview"],
      ["preview-pinned"],
      ["chartHoverScrubber"],
      ["scrubber-cache"],
      ["scrubber-pin"],
      ["scrubber-focus"],
      ["hover aperture", "hover aperture \\u5df2\\u7ed8\\u5236"],
      [pinnedPoint, "\\u5df2\\u56fa\\u5b9a\\u70b9\\u4f4d"],
      [cacheHitRateText, "\\u7f13\\u5b58\\u547d\\u4e2d\\u7387"],
      [hoverDrawn, "hover tooltip \\u5df2\\u7ed8\\u5236"],
    ];
    for(const options of groups){
      if(!options.some((token) => html.includes(token))) throw new Error(`analytics hover preview missing ${options.join(" or ")}`);
    }
  }
  if(label === "analytics total"){
    for(const token of ["usage-total-board", "usage-total-hero", "usage-total-strip", "usage-total-cache", "chart-card", "usageChart", "--cache-hit:"]){
      if(!html.includes(token)) throw new Error(`analytics total preview missing ${token}`);
    }
  }
}
function screenshot(chrome, htmlPath, pngPath){
  const result = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=800", "--window-size=1280,860", `--screenshot=${pngPath}`, fileUrl(htmlPath)], { encoding:"utf8" });
  if(result.status !== 0){ process.stderr.write(result.stderr || result.stdout || "Chrome screenshot failed\n"); process.exit(result.status || 1); }
}
(async () => {
  fs.mkdirSync(outDir, { recursive:true });
  const baseHtml = fs.readFileSync(path.join(root, "src", "dashboard.html"), "utf8").replaceAll("../assets/", "../../assets/");
  const sessionHtml = buildPreviewHtml(baseHtml, (await renderAppHtml("sessions")).replaceAll("../assets/", "../../assets/"));
  const analyticsAppHtml = (await renderAppHtml("analytics")).replaceAll("../assets/", "../../assets/");
  const analyticsTotalHtml = buildPreviewHtml(baseHtml, analyticsAppHtml, { analyticsTotal: true });
  const analyticsHtml = buildPreviewHtml(baseHtml, analyticsAppHtml, { analyticsChart: true });
  const analyticsHoverHtml = buildPreviewHtml(baseHtml, analyticsAppHtml, { analyticsChart: true, pinnedHover: true });
  const analyticsDateHtml = buildPreviewHtml(baseHtml, (await renderAppHtml("analytics", { openDateRange: true })).replaceAll("../assets/", "../../assets/"), { analyticsTotal: true });
  assertPreviewHtml('session', sessionHtml);
  assertPreviewHtml('analytics total', analyticsTotalHtml);
  assertPreviewHtml('analytics', analyticsHtml);
  assertPreviewHtml('analytics hover', analyticsHoverHtml);
  assertPreviewHtml('analytics date', analyticsDateHtml);
  fs.writeFileSync(previewPath, sessionHtml);
  fs.writeFileSync(analyticsTotalPreviewPath, analyticsTotalHtml);
  fs.writeFileSync(analyticsPreviewPath, analyticsHtml);
  fs.writeFileSync(analyticsHoverPreviewPath, analyticsHoverHtml);
  fs.writeFileSync(analyticsDatePreviewPath, analyticsDateHtml);
  const chrome = findChrome();
  if(!chrome){ console.log(`preview: ${previewPath}`); console.log(`analytics total preview: ${analyticsTotalPreviewPath}`); console.log(`analytics preview: ${analyticsPreviewPath}`); console.log(`analytics hover preview: ${analyticsHoverPreviewPath}`); console.log(`analytics date preview: ${analyticsDatePreviewPath}`); process.exit(0); }
  screenshot(chrome, previewPath, screenshotPath);
  screenshot(chrome, analyticsTotalPreviewPath, analyticsTotalScreenshotPath);
  screenshot(chrome, analyticsPreviewPath, analyticsScreenshotPath);
  screenshot(chrome, analyticsHoverPreviewPath, analyticsHoverScreenshotPath);
  screenshot(chrome, analyticsDatePreviewPath, analyticsDateScreenshotPath);
  console.log(`preview: ${previewPath}`);
  console.log(`screenshot: ${screenshotPath}`);
  console.log(`analytics total preview: ${analyticsTotalPreviewPath}`);
  console.log(`analytics total screenshot: ${analyticsTotalScreenshotPath}`);
  console.log(`analytics preview: ${analyticsPreviewPath}`);
  console.log(`analytics screenshot: ${analyticsScreenshotPath}`);
  console.log(`analytics hover preview: ${analyticsHoverPreviewPath}`);
  console.log(`analytics hover screenshot: ${analyticsHoverScreenshotPath}`);
  console.log(`analytics date preview: ${analyticsDatePreviewPath}`);
  console.log(`analytics date screenshot: ${analyticsDateScreenshotPath}`);
})();
