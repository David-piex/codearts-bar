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
    : '| 暂无 | - | - |';
  return `# CodeArts Bar ${version}

生成时间：${generatedAt}

## 开源版发布说明

- 面向开发者本地使用，优先保证数据读取、性能、诊断和可验证发布产物。
- Windows 安装包 / 便携包用于桌面托盘和仪表盘。
- CLI zip 用于命令行环境；SQLite 优先使用 \`node:sqlite\`，不可用时回退到 \`sql.js\`。
- VSIX 用于编辑器状态展示。

## 校验

下载后可以使用 \`SHA256SUMS.txt\` 校验产物完整性。

| 文件 | 大小 bytes | SHA256 |
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
