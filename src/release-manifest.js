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

function requireArtifacts(releaseDir, names = []) {
  const required = [...new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean))];
  const missing = [];
  const invalid = [];
  for (const name of required) {
    if (path.basename(name) !== name) {
      invalid.push(name);
      continue;
    }
    const file = path.join(releaseDir, name);
    let stat = null;
    try { stat = fs.statSync(file); } catch {}
    if (!stat || !stat.isFile()) missing.push(name);
    else if (stat.size <= 0) invalid.push(name);
  }
  if (missing.length || invalid.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      invalid.length ? `invalid/empty: ${invalid.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Release artifact validation failed (${details})`);
  }
  return required.map((name) => artifactInfo(path.join(releaseDir, name))).sort((a, b) => a.name.localeCompare(b.name));
}

function generatedAtFromEnvironment(env = process.env) {
  if (env.SOURCE_DATE_EPOCH != null && env.SOURCE_DATE_EPOCH !== '') {
    const seconds = Number(env.SOURCE_DATE_EPOCH);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer');
    return new Date(Math.trunc(seconds) * 1000).toISOString();
  }
  return new Date().toISOString();
}

function sha256SumsText(artifacts = []) {
  return artifacts.map((item) => `${item.sha256}  ${item.name}`).join('\n') + (artifacts.length ? '\n' : '');
}

function releaseNotesText({ version, generatedAt, artifacts = [], source = null }) {
  const rows = artifacts.length
    ? artifacts.map((item) => `| \`${item.name}\` | ${item.size} | \`${item.sha256}\` |`).join('\n')
    : '| \u6682\u65e0 | - | - |';
  const sourceText = source
    ? `\nSource commit: \`${source.commit}\`  \nSource tree SHA256: \`${source.treeSha256}\`  \nTracked worktree: ${source.dirty ? 'dirty' : 'clean'}\n`
    : '';
  return `# CodeArts Bar ${version}

\u751f\u6210\u65f6\u95f4\uff1a${generatedAt}
${sourceText}

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
  const generatedAt = options.generatedAt || generatedAtFromEnvironment(options.env || process.env);
  const artifactNames = options.artifactNames || [];
  if (!artifactNames.length) throw new Error('writeReleaseManifest requires artifactNames');
  const artifacts = requireArtifacts(releaseDir, artifactNames);
  const source = options.source || null;
  const latest = { version, generatedAt, ...(source ? { source } : {}), artifacts };
  fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), sha256SumsText(artifacts), 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'RELEASE_NOTES.md'), releaseNotesText({ version, generatedAt, artifacts, source }), 'utf8');
  return latest;
}

function parseSha256Sums(text = '') {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([0-9a-f]{64})  (.+)$/i);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
    if (out.has(match[2])) throw new Error(`Duplicate SHA256SUMS entry: ${match[2]}`);
    out.set(match[2], match[1].toLowerCase());
  }
  return out;
}

function verifyReleaseManifest(options = {}) {
  const releaseDir = path.resolve(options.releaseDir || 'release');
  const artifactNames = [...new Set(options.artifactNames || [])].sort((a, b) => a.localeCompare(b));
  const expectedVersion = options.version == null ? null : String(options.version).trim();
  const latestFile = path.join(releaseDir, 'latest.json');
  const sumsFile = path.join(releaseDir, 'SHA256SUMS.txt');
  if (!fs.existsSync(latestFile) || !fs.existsSync(sumsFile)) throw new Error('Release manifest files are missing');
  const latest = JSON.parse(fs.readFileSync(latestFile, 'utf8').replace(/^\uFEFF/, ''));
  if (expectedVersion && latest.version !== expectedVersion) throw new Error(`latest.json version mismatch: expected ${expectedVersion}, got ${latest.version || '<missing>'}`);
  if (options.source) {
    for (const key of ['commit', 'treeSha256', 'dirty', 'trackedFiles']) {
      if (latest.source?.[key] !== options.source[key]) throw new Error(`latest.json source identity mismatch for ${key}`);
    }
  }
  const sums = parseSha256Sums(fs.readFileSync(sumsFile, 'utf8'));
  const listed = (latest.artifacts || []).map((item) => item.name).sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(listed) !== JSON.stringify(artifactNames)) throw new Error('latest.json artifact set does not match required release artifacts');
  if (sums.size !== artifactNames.length) throw new Error('SHA256SUMS artifact count does not match required release artifacts');
  for (const item of requireArtifacts(releaseDir, artifactNames)) {
    const latestItem = latest.artifacts.find((entry) => entry.name === item.name);
    if (!latestItem || latestItem.size !== item.size || latestItem.sha256 !== item.sha256) throw new Error(`latest.json integrity mismatch for ${item.name}`);
    if (sums.get(item.name) !== item.sha256) throw new Error(`SHA256SUMS integrity mismatch for ${item.name}`);
  }
  return latest;
}

module.exports = {
  artifactInfo,
  existingArtifacts,
  generatedAtFromEnvironment,
  releaseNotesText,
  requireArtifacts,
  parseSha256Sums,
  sha256,
  sha256SumsText,
  writeReleaseManifest,
  verifyReleaseManifest,
};
