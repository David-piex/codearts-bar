'use strict';

const { bestEffortStats } = require('./core/best-effort');
const crypto=require('node:crypto');
function hashText(value=''){return crypto.createHash('sha1').update(String(value||'')).digest('hex').slice(0,12);}
function sanitizeText(value=''){return String(value||'').replace(/[A-Za-z]:[\\/][^\s'",;]+/g,'[path]').replace(/\/(?:[^/\s'",;]+\/)+[^/\s'",;]+/g,'[path]').replace(/\\\\(?:[^\\\s'",;]+\\)+[^\\\s'",;]+/g,'[path]').slice(0,500);}
function pathSummary(filePath='',fs,path){const value=String(filePath||'');let exists=false;try{exists=Boolean(value&&fs.existsSync(value));}catch{}return{name:value?path.basename(value):'',hash:value?hashText(value):'',exists};}
function buildUnifiedDiagnostics({snapshot=null,database=null,runtime=null,performance=null,paths={},fs,path,version=''}){const issues=[];for(const source of [snapshot?.health?.issues,database?.diagnostics?.issues,runtime?.issues])for(const issue of Array.isArray(source)?source:[])issues.push({code:String(issue?.code||''),level:String(issue?.tone||issue?.level||'info'),title:sanitizeText(issue?.title||issue?.code||''),detail:sanitizeText(issue?.detail||issue?.message||issue?.error||'')});return{schemaVersion:1,generatedAt:Date.now(),version,errorGovernance:bestEffortStats(),health:snapshot?.health||null,database,adapter:snapshot?.adapter||database?.adapter||null,rollup:performance?.usageRollup||null,cache:performance?.aggregateCache||null,slowQueries:performance?.slowAggregates||null,runtime,paths:Object.fromEntries(Object.entries(paths).map(([k,v])=>[k,pathSummary(v,fs,path)])),issues};}
module.exports={buildUnifiedDiagnostics,hashText,sanitizeText,pathSummary};
