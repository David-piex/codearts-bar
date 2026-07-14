'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const release=path.resolve(process.env.CODEARTS_BAR_RELEASE_DIR||path.join(root,'release'));
const small=path.join(release,'codearts-bar-cli.zip');
const standalone=path.join(release,'codearts-bar-cli-standalone.zip');
for(const file of [small,standalone]) assert.equal(fs.existsSync(file),true,`missing ${file}`);
assert.ok(fs.statSync(small).size < 2*1024*1024,`system-Node CLI zip should stay below 2 MiB, got ${fs.statSync(small).size}`);
assert.ok(fs.statSync(standalone).size > 10*1024*1024,'standalone CLI should include Node runtime');
const list=(file)=>execFileSync('tar.exe',['-tf',file],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).map(x=>x.replace(/\\/g,'/'));
const smallEntries=list(small), standaloneEntries=list(standalone);
assert.ok(smallEntries.some(x=>x.endsWith('src/bin.js')));
assert.equal(smallEntries.some(x=>x.endsWith('node.exe')),false);
assert.equal(smallEntries.some(x=>x.includes('codearts-bar-cli-standalone')),false);
assert.ok(standaloneEntries.some(x=>x.endsWith('node.exe')));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'codearts-cli-release-'));
try { execFileSync('tar.exe',['-xf',small,'-C',temp]); const top=fs.readdirSync(temp,{withFileTypes:true}); const base=top.length===1&&top[0].isDirectory()?path.join(temp,top[0].name):temp; const bin=path.join(base,'src','bin.js'); const fixtureDb=path.resolve(process.env.CODEARTS_BAR_FIXTURE_DB||path.join(root,'tests','fixtures','opencode-fixture.db')); const fixtureConfig=path.resolve(process.env.CODEARTS_BAR_FIXTURE_CONFIG_DIR||path.join(temp,'config')); const run=spawnSync(process.execPath,[bin,'self-test','--fixture-db',fixtureDb,'--config-dir',fixtureConfig,'--now-ms',process.env.CODEARTS_BAR_NOW_MS||'1783512000000'],{cwd:path.dirname(path.dirname(bin)),encoding:'utf8',timeout:30000,env:{...process.env,CODEARTS_BAR_DB:fixtureDb,CODEARTS_BAR_CONFIG_DIR:fixtureConfig}}); assert.equal(run.status,0,run.stderr||run.stdout); assert.doesNotMatch(run.stdout,/fixture-model|multi-model|ses_multi/); }
finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log(`ok - cli release smoke small=${fs.statSync(small).size} standalone=${fs.statSync(standalone).size}`);
