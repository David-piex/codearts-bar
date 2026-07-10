'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const { dashboardHtml } = loadHtmlModule();
function loadHtmlModule() {
  const file = path.join(root, 'extension', 'webview', 'html.js');
  const source = fs.readFileSync(file, 'utf8').replace("const vscode = require(\"vscode\");", `const vscode = { Uri: { joinPath: (_base, ...parts) => parts.join('/') } };`);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require, Math }, { filename: file });
  return module.exports;
}
function previewHtml() {
  const webview = { cspSource: "'self'", asWebviewUri: (uri) => uri };
  let html = dashboardHtml(webview, '', 'panel');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_m, rel) => `<style>${fs.readFileSync(path.join(root, 'extension', rel), 'utf8')}</style>`);
  html = html.replace(/<script nonce="[^"]+" src="([^"]+)"><\/script>/g, (_m, rel) => `<script>${fs.readFileSync(path.join(root, 'extension', rel), 'utf8')}</script>`);
  html = html.replace('<body ', `<body><script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){return{}},setState(){}});</script><div `).replace('<div data-mode=', '<main data-mode=');
  return html;
}
const base = Date.UTC(2026,6,10,8,0,0);
function snapshot(zero=false) {
  const hourly = Array.from({length:24},(_,i)=>({start:base-(23-i)*3600000,total:zero?0:Math.round(5000+Math.sin(i/2)*2200+i*420),output:zero?0:Math.round(1200+Math.cos(i/3)*500+i*110),input:zero?0:1800+i*80,cacheRead:zero?0:2400+i*180}));
  return {ok:true,updatedAt:'刚刚更新',adapter:'sql.js-worker',status:{level:'normal',label:'42%'},usage:{today:{total:128420,messages:36,errors:1,cacheHitRate:.71,cacheRead:81200},window:{total:238000,messages:68,errors:1,cacheHitRate:.68,cacheRead:140000},week:{total:980000,messages:280,errors:3},all:{total:4210000,messages:1220,errors:8}},config:{windowHours:24},trends:{hourly24h:hourly,daily14d:hourly.slice(0,14)},models:[{name:'GLM-5.1',provider:'CodeArts',total:78200,messages:20},{name:'GPT-5.5',provider:'CodeArts',total:36200,messages:10},{name:'DeepSeek V4 Flash',provider:'CodeArts',total:14020,messages:6}],sources:[{id:'desktop',label:'桌面端',total:88420,messages:24},{id:'cli',label:'CLI',total:40000,messages:12}],sessions:[{id:'1',title:'首次打开与趋势图优化',directory:'C:/projects/codearts-bar',sourceLabel:'桌面端',age:120000,total:42000,model:'GLM-5.1'},{id:'2',title:'VS Code Webview 性能回归',directory:'C:/projects/plugin',sourceLabel:'CLI',age:3600000,total:28200,model:'GPT-5.5'}],performance:{latencyAvg:1280,latencyP95:3100,firstContentAvg:420,outputSpeed:31.8,errorRate:.014,queueAvg:92,queueP95:180},dbSize:14800000,stale:false};
}
(async()=>{
  fs.mkdirSync(outDir,{recursive:true});
  const file=path.join(root,'.cache','vscode-webview-preview.html'); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,previewHtml(),'utf8');
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync); if(!chrome) throw new Error('Chrome or Edge not found'); const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--allow-file-access-from-files']}); const page=await browser.newPage(); await page.setViewport({width:1120,height:900,deviceScaleFactor:1});
  await page.goto('file:///'+file.replace(/\\/g,'/')); await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data}})),snapshot(false)); await new Promise(r=>setTimeout(r,400));
  const canvas=await page.$('#trendChart'); const box=await canvas.boundingBox(); await page.evaluate(() => { const c=document.querySelector('#trendChart'); const r=c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.left+r.width*.72,clientY:r.top+r.height*.45})); }); await new Promise(r=>setTimeout(r,200)); const tooltipVisible=await page.$eval('[data-chart-tooltip]',el=>!el.hidden); if(!tooltipVisible) throw new Error('tooltip did not become visible'); await page.screenshot({path:path.join(outDir,'vscode-tooltip.png'),fullPage:true});
  await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data}})),snapshot(true)); await new Promise(r=>setTimeout(r,300)); await page.screenshot({path:path.join(outDir,'vscode-empty-state.png'),fullPage:true});
  await browser.close(); console.log('ok - vscode README screenshots');
})().catch(e=>{console.error(e);process.exit(1)});

