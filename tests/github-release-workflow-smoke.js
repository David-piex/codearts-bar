'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const cross = fs.readFileSync(path.join(root, '.github', 'workflows', 'cross-platform-build.yml'), 'utf8');
const windows = fs.readFileSync(path.join(root, '.github', 'workflows', 'windows-verify.yml'), 'utf8');
const visualRegression = fs.readFileSync(path.join(root, 'tests', 'visual-regression.js'), 'utf8');

assert.match(release, /tags:\s*\["CodeArts-Bar-\*"\]/);
assert.match(release, /contents:\s*write/);
assert.match(release, /Tag \$env:GITHUB_REF_NAME must equal \$expected/);
assert.match(release, /npm test[\s\S]*e2e:electron:built[\s\S]*e2e:vscode[\s\S]*verify:jetbrains/);
assert.match(release, /node src\/release\.js/);
assert.match(release, /gh release create/);
assert.match(release, /SHA256|RELEASE_NOTES|release\/\*/);
assert.doesNotMatch(release, /gitee\.com/i);
assert.match(cross, /tags:\s*\["CodeArts-Bar-\*"\]/);
assert.doesNotMatch(cross, /refs\/tags\/v/);
assert.match(windows, /node tests\/visual-regression\.js[\s\S]*CODEARTS_BAR_CI_DISPLAY_LIMITED:\s*"1"/);
assert.match(visualRegression, /process\.env\.CI === '1' && process\.env\.CODEARTS_BAR_CI_DISPLAY_LIMITED === '1'/);
assert.match(visualRegression, /item\.actualDir === electronDir/);
assert.match(visualRegression, /ciMaxDiffRatio: 0\.006/);
console.log('ok - GitHub canonical release workflow');
