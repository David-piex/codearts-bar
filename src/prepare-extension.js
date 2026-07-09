const fs = require('node:fs');
const path = require('node:path');
function readJsonNoBom(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function asciiJson(obj) { return JSON.stringify(obj, null, 2).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n'; }
const root = path.resolve(__dirname, '..');
const srcPkg = readJsonNoBom(path.join(root, 'package.json'));
const extDir = path.join(root, 'extension');
const extPkgPath = path.join(extDir, 'package.json');
const extPkg = readJsonNoBom(extPkgPath);
extPkg.version = srcPkg.version;
extPkg.displayName = '\u7801\u9053\u72b6\u6001\u680f';
extPkg.description = '\u5728 VS Code / CodeArts Agent \u72b6\u6001\u680f\u663e\u793a\u672c\u5730\u7801\u9053 token \u4f7f\u7528\u60c5\u51b5\u3002';
const titles = {
  'codeartsBar.refresh': '\u7801\u9053\u72b6\u6001\u680f\uff1a\u5237\u65b0\u4f7f\u7528\u60c5\u51b5',
  'codeartsBar.showDetails': '\u7801\u9053\u72b6\u6001\u680f\uff1a\u663e\u793a\u8be6\u60c5',
  'codeartsBar.openDataFolder': '\u7801\u9053\u72b6\u6001\u680f\uff1a\u6253\u5f00\u6570\u636e\u76ee\u5f55',
};
for (const c of extPkg.contributes.commands || []) if (titles[c.command]) c.title = titles[c.command];
extPkg.contributes.configuration.title = '\u7801\u9053\u72b6\u6001\u680f';
const props = extPkg.contributes.configuration.properties;
props['codeartsBar.dbPath'].description = 'CodeArts opencode.db \u8def\u5f84\u3002\u4e3a\u7a7a\u65f6\u4f7f\u7528 ~/.codeartsdoer/codearts-data/opencode.db\u3002';
props['codeartsBar.dailyLimit'].description = '\u72b6\u6001\u680f\u767e\u5206\u6bd4\u4f7f\u7528\u7684\u6bcf\u65e5 token \u663e\u793a\u8f6f\u4e0a\u9650\u3002';
props['codeartsBar.windowHours'].description = '\u6eda\u52a8\u7a97\u53e3\u7edf\u8ba1\u5c0f\u65f6\u6570\u3002';
props['codeartsBar.refreshMs'].description = '\u81ea\u52a8\u5237\u65b0\u95f4\u9694\uff0c\u6beb\u79d2\u3002';
const runtimeFiles = [
  'core/aggregator.js',
  'core/cacheMetrics.js',
  'core/format.js',
  'health.js',
  'quota.js',
  'providers/index.js',
  'providers/codeartsLocal.js',
  'providers/codeartsOfficial.js',
  'providers/codeartsDesktop.js',
  'providers/codearts/aggregation-sql.js',
  'providers/codearts/aggregation.js',
  'providers/codearts/collect.js',
  'providers/codearts/logs.js',
  'providers/codearts/pagination.js',
  'providers/codearts/session-actions.js',
  'providers/codearts/sources.js',
  'providers/codearts/sqlite.js',
];
for (const file of runtimeFiles) if (!extPkg.files.includes(file)) extPkg.files.push(file);
fs.writeFileSync(extPkgPath, asciiJson(extPkg), 'utf8');
for (const file of ['codeartsData.js', 'officialStats.js', 'authStatus.js', 'settings.js', 'quota.js', 'health.js']) fs.copyFileSync(path.join(root, 'src', file), path.join(extDir, file));
fs.cpSync(path.join(root, 'src', 'providers'), path.join(extDir, 'providers'), { recursive: true });
fs.cpSync(path.join(root, 'src', 'core'), path.join(extDir, 'core'), { recursive: true });
const wasmDir = path.join(extDir, 'node_modules', 'sql.js', 'dist');
fs.mkdirSync(wasmDir, { recursive: true });
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', file), path.join(wasmDir, file));
console.log(`Prepared extension ${extPkg.name}@${extPkg.version}`);
