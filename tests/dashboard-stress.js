
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeCtx(){
  return {
    scale(){}, clearRect(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, stroke(){}, fill(){}, fillText(){}, closePath(){}, save(){}, restore(){}, setLineDash(){}, arc(){}, roundRect(){},
    measureText(text){ return { width: String(text || "").length * 7 }; },
    createLinearGradient(){ return { addColorStop(){} }; },
    createRadialGradient(){ return { addColorStop(){} }; },
  };
}
function makeElement(id){
  return {
    id, innerHTML:"", textContent:"", style:{ setProperty(){} },
    classList:{ add(){}, remove(){}, toggle(){} },
    closest(){ return null; }, focus(){}, select(){}, setSelectionRange(){},
    getBoundingClientRect(){ return id === "usageChart" ? { left:0, top:0, width:1180, height:320 } : { left:0, top:0, width:260, height:220 }; },
    getContext(){ return makeCtx(); },
  };
}
function makeStorage(initial = {}){
  const data = new Map(Object.entries(initial));
  return { getItem(k){ return data.has(k) ? data.get(k) : null; }, setItem(k,v){ data.set(k,String(v)); }, removeItem(k){ data.delete(k); } };
}
function makeSnapshot(requestCount = 5200, sessionCount = 900){
  const now = Date.UTC(2026, 6, 8, 12, 0, 0);
  const H = 3600000;
  const models = ["GLM-5.1", "gpt-5.5", "deepseek-v4-flash", "claude-sonnet"];
  const requestLog = [];
  for(let i=0;i<requestCount;i++){
    const source = i % 3 === 0 ? "cli" : "desktop";
    const sessionId = `stress-${i % sessionCount}`;
    const input = 400 + (i % 31) * 37;
    const output = 120 + (i % 19) * 23;
    const cacheRead = i % 5 === 0 ? 0 : 900 + (i % 47) * 61;
    const cacheWrite = i % 7 === 0 ? 0 : 80 + (i % 11) * 17;
    requestLog.push({ id:`r-${i}`, sessionId, sessionTitle:`\u4f1a\u8bdd ${i % sessionCount}`, source, sourceLabel: source === "cli" ? "CLI" : "\u684c\u9762\u7aef", provider:"codearts", model:models[i % models.length], time:now - (i % 168) * H / 2, input, output, cacheRead, cacheWrite, total:input + output + cacheRead + cacheWrite, ok:i % 97 !== 0, status:i % 97 === 0 ? "500" : "200", latencyMs:900 + (i % 80) * 30, ttftMs:180 + (i % 40) * 20, firstContentMs:260 + (i % 40) * 20, outputTokensPerSec:12 + (i % 45) });
  }
  const bySession = new Map();
  for(const r of requestLog){
    const k = `${r.source}:${r.sessionId}`;
    const prev = bySession.get(k) || { id:r.sessionId, title:r.sessionTitle, directory:`C:/stress/project-${Number(r.sessionId.split('-')[1]) % 40}`, version:"1", createdAt:now - 20 * H, updatedAt:r.time, archived:false, source:r.source, sourceLabel:r.sourceLabel, dbPath:"stress", usage:{ total:0,input:0,output:0,cacheRead:0,cacheWrite:0,userTurns:0,modelCalls:0,models:[] } };
    prev.updatedAt = Math.max(prev.updatedAt, r.time);
    prev.usage.total += r.total; prev.usage.input += r.input; prev.usage.output += r.output; prev.usage.cacheRead += r.cacheRead; prev.usage.cacheWrite += r.cacheWrite; prev.usage.userTurns += 1; prev.usage.modelCalls += 1;
    bySession.set(k, prev);
  }
  const usage = requestLog.reduce((a,r) => { a.total += r.total; a.input += r.input; a.output += r.output; a.cacheRead += r.cacheRead; a.cacheWrite += r.cacheWrite; a.requests += 1; return a; }, { total:0,input:0,output:0,cacheRead:0,cacheWrite:0,requests:0 });
  return { ok:true, timestamp:now, updatedAt:"2026/07/08 20:00", sources:[{ id:"desktop", source:"desktop", label:"\u684c\u9762\u7aef" }, { id:"cli", source:"cli", label:"CLI" }], usage:{ today:usage, window:usage, week:usage, all:usage }, queue:{ window:{ samples:20, avg:1200 }, trends:{ hourly24h:[] } }, requestLog, sessions:[...bySession.values()], status:{ usagePercent:50, level:"ok", label:"50%" } };
}
async function main(){
  const snapshot = makeSnapshot();
  const elements = new Map();
  const listeners = {};
  const document = { body:{ style:{ setProperty(){} }, classList:{ add(){}, remove(){}, toggle(){} } }, currentScript:null, getElementById(id){ if(!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); }, addEventListener(type, fn){ listeners[type]=fn; }, querySelector(){ return null; }, querySelectorAll(){ return []; } };
  const ipcRenderer = { async invoke(channel){ if(channel === "dashboard:getSnapshot" || channel === "dashboard:refresh") return snapshot; return { ok:true }; }, on(){} };
  const context = { console, require(name){ if(name === "electron") return { ipcRenderer }; if(name === "node:fs") return require("node:fs"); if(name === "node:path") return require("node:path"); throw new Error(`Unexpected require: ${name}`); }, window:{ codeartsApi:ipcRenderer, matchMedia:()=>({ matches:false }), devicePixelRatio:1, innerWidth:1280, innerHeight:860, addEventListener(){} }, document, localStorage:makeStorage({ workspaceMode:"analytics", statsRange:"7d", chartSeries:"total,input,output,cacheRead" }), navigator:{ clipboard:{ writeText: async()=>{} } }, setInterval(){ return 1; }, clearInterval(){}, setTimeout(fn){ if(typeof fn === "function") fn(); return 1; }, clearTimeout(){}, requestAnimationFrame(fn){ if(typeof fn === "function") fn(Date.now()); return 1; }, cancelAnimationFrame(){}, performance, Date, Intl, Math, Number, String, Boolean, JSON, Map, Set, Array, Object, RegExp, Error, Promise };
  context.globalThis = context;
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, "..", "src", "dashboard-renderer.js"), "utf8");
  const start = performance.now();
  vm.runInContext(code, context, { filename:"dashboard-renderer.js" });
  for(let i=0;i<10;i++) await new Promise((resolve) => setImmediate(resolve));
  const elapsed = performance.now() - start;
  const html = elements.get("app").innerHTML;
  assert.match(html, /usage-total-board/);
  assert.match(html, /chart-card/);
  assert.ok(elapsed < 5000, `dashboard stress render too slow: ${elapsed.toFixed(1)}ms`);
  console.log(`ok - dashboard stress ${elapsed.toFixed(1)}ms | requests=${snapshot.requestLog.length} sessions=${snapshot.sessions.length} html=${html.length}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
