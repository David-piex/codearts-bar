'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifactInfo(file) {
  const stat = fs.statSync(file);
  return {
    name: path.basename(file),
    size: stat.size,
    sha256: sha256(file),
  };
}

function existingArtifacts(releaseDir, names = []) {
  return names
    .map((name) => path.join(releaseDir, name))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .map(artifactInfo)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sha256SumsText(artifacts = []) {
  return artifacts.map((item) => `${item.sha256}  ${item.name}`).join('\n') + (artifacts.length ? '\n' : '');
}

function releaseNotesText({ version, generatedAt, artifacts = [] }) {
  const rows = artifacts.length
    ? artifacts.map((item) => `| \`${item.name}\` | ${item.size} | \`${item.sha256}\` |`).join('\n')
    : '| \u6682\u65e0 | - | - |';
  return `# CodeArts Bar ${version}

\u751f\u6210\u65f6\u95f4\uff1a${generatedAt}

## \u5f00\u6e90\u7248\u53d1\u5e03\u8bf4\u660e

- Windows \u5b89\u88c5\u7248\u548c\u4fbf\u643a\u7248\u7528\u4e8e\u684c\u9762\u6258\u76d8\u4e0e\u4f7f\u7528\u5206\u6790\u3002
- \`codearts-bar-cli.zip\` \u662f\u8f7b\u91cf CLI\uff0c\u9700\u8981\u7cfb\u7edf Node.js 18 \u6216\u66f4\u9ad8\u7248\u672c\u3002
- \`codearts-bar-cli-standalone.zip\` \u5185\u7f6e Node.js\uff0c\u53ef\u76f4\u63a5\u79bb\u7ebf\u8fd0\u884c\u3002
- \`codearts-bar-${version}.tgz\` \u662f\u7cbe\u7b80 npm CLI \u5305\u3002
- VSIX \u7528\u4e8e VS Code / CodeArts \u7f16\u8f91\u5668\u3002

## \u6821\u9a8c

\u4e0b\u8f7d\u540e\u53ef\u4f7f\u7528 \`SHA256SUMS.txt\` \u6821\u9a8c\u4ea7\u7269\u5b8c\u6574\u6027\u3002

| \u6587\u4ef6 | \u5927\u5c0f bytes | SHA256 |
|---|---:|---|
${rows}
`;
}
function writeReleaseManifest(options = {}) {
  const releaseDir = path.resolve(options.releaseDir || 'release');
  const version = String(options.version || '').trim();
  if (!version) throw new Error('writeReleaseManifest requires version');
  fs.mkdirSync(releaseDir, { recursive: true });
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifactNames = options.artifactNames || [];
  const artifacts = existingArtifacts(releaseDir, artifactNames);
  const latest = { version, generatedAt, artifacts };
  fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), sha256SumsText(artifacts), 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'RELEASE_NOTES.md'), releaseNotesText({ version, generatedAt, artifacts }), 'utf8');
  return latest;
}

module.exports = {
  artifactInfo,
  existingArtifacts,
  releaseNotesText,
  sha256,
  sha256SumsText,
  writeReleaseManifest,
};
