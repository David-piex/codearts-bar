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
function previewHtml(mode='panel') {
  const webview = { cspSource: "'self'", asWebviewUri: (uri) => uri };
  let html = dashboardHtml(webview, '', mode);
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_m, rel) => `<style>${fs.readFileSync(path.join(root, 'extension', rel), 'utf8')}</style>`);
  html = html.replace(/<script nonce="[^"]+" src="([^"]+)"><\/script>/g, (_m, rel) => `<script>${fs.readFileSync(path.join(root, 'extension', rel), 'utf8')}</script>`);
  html = html.replace(/<body data-mode="([^"]+)">/, `<body data-mode="$1"><script>window.__vscodeMessages=[];window.__vscodeState={};window.acquireVsCodeApi=()=>({postMessage(message){window.__vscodeMessages.push(message)},getState(){return window.__vscodeState},setState(state){window.__vscodeState=state}});</script>`);
  return html;
}
const base = Date.UTC(2026,6,10,8,0,0);
function snapshot(zero=false) {
  const hourly = Array.from({length:24},(_,i)=>({start:base-(23-i)*3600000,total:zero?0:Math.round(5000+Math.sin(i/2)*2200+i*420),output:zero?0:Math.round(1200+Math.cos(i/3)*500+i*110),input:zero?0:1800+i*80,cacheRead:zero?0:2400+i*180}));
  const usage=zero?{total:0,input:0,output:0,cacheWrite:0,cacheRead:0,messages:0,errors:0,cacheHitRate:null}:{total:128420,input:31200,output:11820,cacheWrite:4420,cacheRead:80980,messages:36,errors:1,cacheHitRate:72.2};
  const requests=zero?[]:Array.from({length:18},(_,i)=>({id:String(i),time:base-i*1900000,sessionTitle:i===0?'调用接口 access_key: [redacted], secret_key: [redacted]':i%2?'趋势图与缓存统计核查':'扩展筛选数据对齐',source:i%3?'desktop':'cli',sourceLabel:i%3?'桌面端':'CLI',provider:'CodeArts',model:i%2?'GLM-5.1':'GPT-5.5',status:i===4?500:200,ok:i!==4,total:3200+i*240,input:900+i*40,output:420+i*18,cacheWrite:i%4?0:120,cacheRead:1800+i*160,latencyMs:820+i*75}));
  const models=zero?[]:[{name:'GLM-5.1',provider:'CodeArts',total:78200,messages:20},{name:'GPT-5.5',provider:'CodeArts',total:36200,messages:10},{name:'DeepSeek V4 Flash',provider:'CodeArts',total:14020,messages:6}];
  const sources=zero?[{id:'desktop',label:'桌面端',total:0,messages:0},{id:'cli',label:'CLI',total:0,messages:0}]:[{id:'desktop',label:'桌面端',total:88420,messages:24},{id:'cli',label:'CLI',total:40000,messages:12}];
  const sessions=zero?[]:[{id:'1',title:'调用接口 access_key: [redacted], secret_key: [redacted]',directory:'C:/projects/codearts-bar',sourceLabel:'桌面端',age:120000,total:42000,model:'GLM-5.1'},{id:'2',title:'VS Code Webview 性能回归',directory:'C:/projects/plugin',sourceLabel:'CLI',age:3600000,total:28200,model:'GPT-5.5'}];
  return {ok:true,timestamp:base,updatedAt:'刚刚更新',adapter:'node:sqlite',capabilities:{performance:false,queue:false},status:{level:'normal',label:zero?'0%':'42%'},usage:{today:usage,range:usage,window:{...usage,total:238000},week:{...usage,total:980000},all:{...usage,total:4210000}},selectedRange:{preset:'today',start:base-8*3600000,end:base,bucketMs:3600000},selectedScope:{source:'all',model:'all'},config:{windowHours:24},trends:{range:hourly,hourly24h:hourly,daily14d:hourly.slice(0,14)},models,sources,sessions,requests,performance:{latencyAvg:1280,latencyP95:3100,firstContentAvg:420,outputSpeed:31.8,errorRate:.014,queueAvg:92,queueP95:180},dbSize:14800000,stale:false};
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
    if(palette.page!=='#f5f6f8'||palette.accent!=='#0a84ff') throw new Error('VS Code theme leaked into fixed Desktop palette: '+JSON.stringify(palette));
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data,generation:1}})),snapshot(false));
    await new Promise(r=>setTimeout(r,400));
    const canvas=await page.$('#trendChart');
    if(!canvas) throw new Error('trend chart was not rendered');
    const box=await canvas.boundingBox();
    if(!box || box.width <= 0 || box.height <= 0) throw new Error('trend chart has no visible geometry');
    await withTimeout('paint trend chart',()=>page.waitForFunction(()=>document.querySelector('#trendChart')?.dataset.yAxisTicks));
    const chartBitmapBefore=await page.$eval('#trendChart',(node)=>({width:node.width,height:node.height,revision:node.dataset.staticRevision}));
    await page.mouse.move(box.x+box.width*.72,box.y+box.height*.45);
    await page.mouse.move(box.x+box.width*.76,box.y+box.height*.48);
    await withTimeout('show chart tooltip',()=>page.waitForFunction(()=>{
      const tooltip=document.querySelector('[data-chart-tooltip]');
      return tooltip && !tooltip.hidden && tooltip.dataset.index !== undefined;
    }));
    const chartBitmapAfter=await page.$eval('#trendChart',(node)=>({width:node.width,height:node.height,revision:node.dataset.staticRevision}));
    if(JSON.stringify(chartBitmapAfter)!==JSON.stringify(chartBitmapBefore)) throw new Error('chart hover rebuilt the static bitmap: '+JSON.stringify({chartBitmapBefore,chartBitmapAfter}));
    const privacy=await page.evaluate(()=>document.body.innerText);
    if(/HPUAGK|JKcewe/.test(privacy)||!privacy.includes('[redacted]')) throw new Error('sensitive session text was not redacted');
    await withTimeout('capture VS Code tooltip',()=>page.screenshot({path:path.join(outDir,'vscode-tooltip.png'),fullPage:true}));
    await page.click('[data-range="custom"]');
    await withTimeout('show custom range',()=>page.waitForFunction(()=>{
      const panel=document.querySelector('#customRange');
      const start=document.querySelector('#rangeStart');
      const end=document.querySelector('#rangeEnd');
      const apply=document.querySelector('[data-range-apply]');
      return panel&&!panel.hidden&&start?.value&&end?.value&&apply?.getBoundingClientRect().width>0;
    }));
    const draftScope = await page.$eval('#filterContext',(node)=>node.textContent || '');
    if(!draftScope.startsWith('今天')) throw new Error('unapplied custom date draft replaced the committed data scope: '+draftScope);
    await page.$eval('#rangeStart',(node)=>{node.value='2026-07-09T09:30';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:{...data,selectedRange:{preset:'week',start:data.timestamp-7*86400000,end:data.timestamp,bucketMs:86400000},selectedScope:{source:'cli',model:'GPT-5.5'}},generation:20}})),snapshot(false));
    const protectedDraft=await page.evaluate(()=>({
      value:document.querySelector('#rangeStart')?.value,
      context:document.querySelector('#filterContext')?.textContent,
      source:document.querySelector('#sourceFilterValue')?.textContent,
      customActive:document.querySelector('[data-range="custom"]')?.classList.contains('active'),
    }));
    if(protectedDraft.value!=='2026-07-09T09:30'||!protectedDraft.context?.startsWith('7 天')||protectedDraft.source!=='CLI'||!protectedDraft.customActive) throw new Error('realtime detail refresh disturbed the custom date draft: '+JSON.stringify(protectedDraft));
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:{...data,selectedScope:{source:'all',model:'all'}},generation:19}})),snapshot(false));
    const sourceAfterStale=await page.$eval('#sourceFilterValue',(node)=>node.textContent || '');
    if(sourceAfterStale!=='CLI') throw new Error('stale detail generation replaced the current scope: '+sourceAfterStale);
    const customGeometry=await page.evaluate(()=>{
      const panel=document.querySelector('#customRange').getBoundingClientRect();
      return {left:panel.left,right:panel.right,width:innerWidth};
    });
    if(customGeometry.left<0||customGeometry.right>customGeometry.width) throw new Error('custom range overflows the wide viewport');
    await withTimeout('capture custom range',()=>page.screenshot({path:path.join(visualDir,'custom-range-wide.png'),fullPage:true}));
    await page.setViewport({width:360,height:900,deviceScaleFactor:1});
    const narrowGeometry=await page.evaluate(()=>{
      const segmented=getComputedStyle(document.querySelector('.range-filter .segmented-control')).display;
      const menu=document.querySelector('.range-menu-control');
      const panel=document.querySelector('#customRange').getBoundingClientRect();
      return {segmented,menu:getComputedStyle(menu).display,left:panel.left,right:panel.right,width:innerWidth};
    });
    if(narrowGeometry.segmented!=='none'||narrowGeometry.menu==='none'||narrowGeometry.left<0||narrowGeometry.right>narrowGeometry.width) throw new Error('narrow range controls are not responsive: '+JSON.stringify(narrowGeometry));
    await withTimeout('capture narrow range',()=>page.screenshot({path:path.join(visualDir,'custom-range-narrow.png'),fullPage:true}));
    await page.click('[data-range-cancel]');
    const cancelled=await page.evaluate(()=>({hidden:document.querySelector('#customRange')?.hidden,range:window.__vscodeState?.range}));
    if(!cancelled.hidden||cancelled.range!=='week') throw new Error('custom date cancel did not restore the committed range: '+JSON.stringify(cancelled));
    const sidebarFile=path.join(root,'.cache','vscode-webview-sidebar-preview.html'); fs.writeFileSync(sidebarFile,previewHtml('sidebar'),'utf8');
    await page.goto('file:///'+sidebarFile.replace(/\\/g,'/'),{waitUntil:'domcontentloaded'});
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data,generation:1}})),snapshot(false));
    const sidebarState=await page.evaluate(()=>({scope:getComputedStyle(document.querySelector('.scope-filter')).display,token:getComputedStyle(document.querySelector('.token-strip')).display,requests:getComputedStyle(document.querySelector('.request-surface')).display}));
    if(sidebarState.scope!=='none'||sidebarState.token!=='none'||sidebarState.requests!=='none') throw new Error('sidebar leaked full-analysis workbench: '+JSON.stringify(sidebarState));
    await page.click('#rangeMenuButton');
    const menuGeometry=await page.evaluate(()=>{
      const trigger=document.querySelector('#rangeMenuButton').getBoundingClientRect();
      const menu=document.querySelector('#rangeMenu').getBoundingClientRect();
      return {hidden:document.querySelector('#rangeMenu').hidden,expanded:document.querySelector('#rangeMenuButton').getAttribute('aria-expanded'),triggerWidth:trigger.width,left:menu.left,right:menu.right,width:menu.width,viewport:innerWidth};
    });
    if(menuGeometry.hidden||menuGeometry.expanded!=='true'||menuGeometry.left<0||menuGeometry.right>menuGeometry.viewport||menuGeometry.width>280||menuGeometry.width<menuGeometry.triggerWidth) throw new Error('controlled range menu geometry is invalid: '+JSON.stringify(menuGeometry));
    await page.screenshot({path:path.join(visualDir,'sidebar-range-menu.png'),fullPage:true});
    await page.keyboard.press('Escape');
    await page.evaluate(()=>document.activeElement?.blur());
    await page.screenshot({path:path.join(visualDir,'sidebar-overview.png'),fullPage:true});
    await page.goto('file:///'+file.replace(/\\/g,'/'),{waitUntil:'domcontentloaded'});
    await page.setViewport({width:1120,height:900,deviceScaleFactor:1});
    await page.evaluate((data)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'details',payload:data,generation:1}})),{...snapshot(true),trends:{hourly24h:[],daily14d:[]}});
    await new Promise(r=>setTimeout(r,300));
    await withTimeout('capture VS Code empty state',()=>page.screenshot({path:path.join(outDir,'vscode-empty-state.png'),fullPage:true}));
    console.log('ok - vscode README screenshots');
  } finally {
    if(page) await withTimeout('close preview page',()=>page.close()).catch(()=>{});
    if(browser) await withTimeout('close preview browser',()=>browser.close(),5000).catch(()=>browser.process()?.kill());
  }
})().catch(e=>{console.error(e);process.exit(1)});

