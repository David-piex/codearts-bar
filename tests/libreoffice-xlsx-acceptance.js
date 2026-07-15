'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const ExcelJS = require('../src/vendor/session-xlsx');
const {
  buildSessionExport,
  buildSessionBatchExport,
  serializeSessionExport,
  serializeSessionBatchExport,
} = require('../src/providers/codearts/session-export');

const root = path.resolve(__dirname, '..');
const fixtureDb = path.join(root, 'tests', 'fixtures', 'opencode-fixture.db');

function resolveSoffice() {
  const candidates = [
    process.env.CODEARTS_BAR_SOFFICE,
    path.join(root, '.cache', 'libreoffice-26.2.4', 'app', 'program', 'soffice.exe'),
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.isFile?.(candidate) || fs.existsSync(candidate)) || '';
}

function runLibreOffice(soffice, source, outputDir, profileDir) {
  const profileUrl = pathToFileURL(profileDir).href;
  const result = spawnSync(soffice, [
    '--headless', '--nologo', '--nodefault', '--nofirststartwizard',
    `-env:UserInstallation=${profileUrl}`,
    '--convert-to', 'xlsx', '--outdir', outputDir, source,
  ], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout || `LibreOffice exited with ${result.status}`);
  const output = path.join(outputDir, path.basename(source));
  assert.equal(fs.existsSync(output), true, `LibreOffice did not write ${output}; stdout=${result.stdout}; stderr=${result.stderr}`);
  assert.ok(fs.statSync(output).size > 1000, `LibreOffice output is unexpectedly small: ${output}`);
  return output;
}

async function readWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook;
}

function cellText(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    if ('text' in value) return String(value.text || '');
    if ('result' in value) return String(value.result || '');
  }
  return String(value ?? '');
}

async function main() {
  const soffice = resolveSoffice();
  assert.ok(soffice, 'LibreOffice soffice executable not found; set CODEARTS_BAR_SOFFICE');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codearts-libreoffice-xlsx-'));
  const sourceDir = path.join(temp, 'source');
  const outputDir = path.join(temp, 'roundtrip');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(outputDir);
  try {
    const options = { dbPath: fixtureDb, useSavedSettings: false, timestamp: 1783512000000 };
    const single = await buildSessionExport({ ...options, sessionId: 'ses_fixture' });
    single.session.title = '中文会话 😀';
    single.messages[0].content = '中文正文 😀\n```js\nconsole.log("ok");\n```';
    const singleSource = path.join(sourceDir, 'single-session.xlsx');
    fs.writeFileSync(singleSource, (await serializeSessionExport(single, 'xlsx')).content);

    const batch = await buildSessionBatchExport({
      ...options,
      sessions: [
        { id: 'ses_fixture', dbPath: fixtureDb },
        { id: 'ses_multi', dbPath: fixtureDb },
      ],
    });
    batch.sessions[0].session.title = '批量中文 😀';
    batch.sessions[0].messages[0].content = '批量正文 😀';
    const batchSource = path.join(sourceDir, 'batch-sessions.xlsx');
    fs.writeFileSync(batchSource, (await serializeSessionBatchExport(batch, 'xlsx')).content);

    const singleOutput = runLibreOffice(soffice, singleSource, outputDir, path.join(temp, 'profile-single'));
    const batchOutput = runLibreOffice(soffice, batchSource, outputDir, path.join(temp, 'profile-batch'));

    const singleBook = await readWorkbook(singleOutput);
    assert.deepEqual(singleBook.worksheets.map((sheet) => sheet.name), ['Summary', 'Messages', 'Requests', 'Tools']);
    assert.equal(singleBook.getWorksheet('Summary').getCell('B3').value, '中文会话 😀');
    assert.match(cellText(singleBook.getWorksheet('Messages').getCell('F2')), /中文正文 😀/);
    assert.equal(singleBook.getWorksheet('Requests').getCell('G1').value, '错误类型');

    const batchBook = await readWorkbook(batchOutput);
    assert.deepEqual(batchBook.worksheets.map((sheet) => sheet.name), ['Sessions', 'Messages', 'Requests', 'Tools']);
    assert.equal(batchBook.getWorksheet('Sessions').getCell('A2').value, 'ses_fixture');
    assert.equal(batchBook.getWorksheet('Sessions').getCell('B2').value, '批量中文 😀');
    assert.equal(batchBook.getWorksheet('Messages').getCell('A2').value, 'ses_fixture');
    assert.match(cellText(batchBook.getWorksheet('Messages').getCell('G2')), /批量正文 😀/);
    assert.equal(batchBook.getWorksheet('Requests').getCell('H1').value, '错误类型');
    assert.ok(batchBook.getWorksheet('Sessions').rowCount >= 3, 'batch workbook must retain both sessions');

    console.log(`ok - LibreOffice XLSX roundtrip single/batch sheets Chinese Emoji session links (${path.basename(soffice)})`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { main, resolveSoffice, runLibreOffice };
