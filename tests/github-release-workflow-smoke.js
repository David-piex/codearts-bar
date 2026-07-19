'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const cross = fs.readFileSync(path.join(root, '.github', 'workflows', 'cross-platform-build.yml'), 'utf8');

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
console.log('ok - GitHub canonical release workflow');
