'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const visualDir = path.join(root, '.cache', 'vscode-webview-visual');
const { dashboardHtml } = loadHtmlModule();
const STEP_TIMEOUT_MS = 15000;

function withTimeout(label, operation, timeoutMs = STEP_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
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
  return {ok:true,timestamp:base,updatedAt:'刚刚更新',adapter:'sql.js-worker',capabilities:{performance:false,queue:false},status:{level:'normal',label:zero?'0%':'42%'},usage:{today:zero?{total:0,messages:0,errors:0,cacheHitRate:null,cacheRead:0}:{total:128420,messages:36,errors:1,cacheHitRate:71,cacheRead:81200},window:{total:238000,messages:68,errors:1,cacheHitRate:68,cacheRead:140000},week:{total:980000,messages:280,errors:3,cacheHitRate:45.7,cacheRead:448000},all:{total:4210000,messages:1220,errors:8,cacheHitRate:42.6,cacheRead:1793000}},config:{windowHours:24},trends:{hourly24h:hourly,daily14d:hourly.slice(0,14)},models:[{name:'GLM-5.1',provider:'CodeArts',total:78200,messages:20},{name:'GPT-5.5',provider:'CodeArts',total:36200,messages:10},{name:'DeepSeek V4 Flash',provider:'CodeArts',total:14020,messages:6}],sources:[{id:'desktop',label:'桌面端',total:88420,messages:24},{id:'cli',label:'CLI',total:40000,messages:12}],sessions:[{id:'1',title:'首次打开与趋势图优化',directory:'C:/projects/codearts-bar',sourceLabel:'桌面端',age:120000,total:42000,model:'GLM-5.1'},{id:'2',title:'VS Code Webview 性能回归',directory:'C:/projects/plugin',sourceLabel:'CLI',age:3600000,total:28200,model:'GPT-5.5'}],performance:{latencyAvg:1280,latencyP95:3100,firstContentAvg:420,outputSpeed:31.8,errorRate:.014,queueAvg:92,queueP95:180},dbSize:14800000,stale:false};
}
(async()=>{
  fs.mkdirSync(outDir,{recursive:true});
  fs.mkdirSync(visualDir,{recursive:true});
  const file=path.join(root,'.cache','vscode-webview-preview.html'); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,previewHtml(),'utf8');
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  if(!chrome) throw new Error('Chrome or Edge not found');
  let browser;
  let page;
  try {
    browser=await withTimeout('launch preview browser',()=>puppeteer.launch({headless:true,executablePath:chrome,args:['--allow-file-access-from-files','--disable-background-networking']}));
    page=await withTimeout('create preview page',()=>browser.newPage());
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(STEP_TIMEOUT_MS);
    await page.setViewport({width:1120,height:900,deviceScaleFactor:1});
    await withTimeout('load VS Code preview',()=>page.goto('file:///'+file.replace(/\\/g,'/'),{waitUntil:'domcontentloaded'}));
    await page.evaluate(()=>document.body.classList.add('vscode-dark'));
    const palette=await page.evaluate(()=>({page:getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}));
    if(palette.page!=='#f7f8fb'||palette.accent!=='#1687f5') throw new Error('VS Code theme leaked into fixed Desktop palette: '+JSON.stringify(palette));
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data}})),snapshot(false));
    await new Promise(r=>setTimeout(r,400));
    const canvas=await page.$('#trendChart');
    if(!canvas) throw new Error('trend chart was not rendered');
    const box=await canvas.boundingBox();
    if(!box || box.width <= 0 || box.height <= 0) throw new Error('trend chart has no visible geometry');
    await page.mouse.move(box.x + box.width * .72, box.y + box.height * .45);
    await withTimeout('show chart tooltip',()=>page.waitForFunction(()=>{
      const tooltip=document.querySelector('[data-chart-tooltip]');
      return tooltip && !tooltip.hidden && tooltip.dataset.index !== undefined;
    }));
    await withTimeout('capture VS Code tooltip',()=>page.screenshot({path:path.join(outDir,'vscode-tooltip.png'),fullPage:true}));
    await page.click('[data-range="custom"]');
    await withTimeout('show custom range',()=>page.waitForFunction(()=>{
      const panel=document.querySelector('#customRange');
      const start=document.querySelector('#rangeStart');
      const end=document.querySelector('#rangeEnd');
      const apply=document.querySelector('[data-range-apply]');
      return panel&&!panel.hidden&&start?.value&&end?.value&&apply?.getBoundingClientRect().width>0;
    }));
    const customGeometry=await page.evaluate(()=>{
      const panel=document.querySelector('#customRange').getBoundingClientRect();
      return {left:panel.left,right:panel.right,width:innerWidth};
    });
    if(customGeometry.left<0||customGeometry.right>customGeometry.width) throw new Error('custom range overflows the wide viewport');
    await withTimeout('capture custom range',()=>page.screenshot({path:path.join(visualDir,'custom-range-wide.png'),fullPage:true}));
    await page.setViewport({width:360,height:900,deviceScaleFactor:1});
    const narrowGeometry=await page.evaluate(()=>{
      const segmented=getComputedStyle(document.querySelector('.range-filter .segmented-control')).display;
      const select=document.querySelector('#rangeSelect');
      const panel=document.querySelector('#customRange').getBoundingClientRect();
      return {segmented,select:getComputedStyle(select).display,left:panel.left,right:panel.right,width:innerWidth};
    });
    if(narrowGeometry.segmented!=='none'||narrowGeometry.select==='none'||narrowGeometry.left<0||narrowGeometry.right>narrowGeometry.width) throw new Error('narrow range controls are not responsive: '+JSON.stringify(narrowGeometry));
    await withTimeout('capture narrow range',()=>page.screenshot({path:path.join(visualDir,'custom-range-narrow.png'),fullPage:true}));
    await page.setViewport({width:1120,height:900,deviceScaleFactor:1});
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data}})),{...snapshot(true),trends:{hourly24h:[],daily14d:[]}});
    await new Promise(r=>setTimeout(r,300));
    await withTimeout('capture VS Code empty state',()=>page.screenshot({path:path.join(outDir,'vscode-empty-state.png'),fullPage:true}));
    console.log('ok - vscode README screenshots');
  } finally {
    if(page) await withTimeout('close preview page',()=>page.close()).catch(()=>{});
    if(browser) await withTimeout('close preview browser',()=>browser.close(),5000).catch(()=>browser.process()?.kill());
  }
})().catch(e=>{console.error(e);process.exit(1)});

