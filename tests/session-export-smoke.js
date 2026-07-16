'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const MarkdownIt = require('markdown-it');
const ExcelJS = require('../src/vendor/session-xlsx');
const { getSnapshotAsync, REQUEST_LOG_SAMPLE_LIMIT } = require('../src/codeartsData');
const {
  normalizeExportModel,
  buildSessionExport,
  buildSessionBatchExport,
  serializeSessionExport,
  serializeSessionBatchExport,
  exportSessionToFile,
  safeFileStem,
  availableOutputPath,
} = require('../src/providers/codearts/session-export');

const root = path.resolve(__dirname, '..');
const work = path.join(root, '.cache', 'session-export-smoke');
const dbPath = path.join(work, 'opencode.db');
const outputDir = path.join(work, 'output');
const now = 1783512000000;
const schema = JSON.parse(fs.readFileSync(path.join(root, 'src', 'providers', 'codearts', 'session-export.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validateExport = ajv.compile(schema);

function assertSchema(model) {
  assert.equal(validateExport(model), true, ajv.errorsText(validateExport.errors, { separator: '\n' }));
}

function createFixture() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table session (id text primary key, project_id text, parent_id text, title text, directory text, version text, time_created integer, time_updated integer, time_archived integer);
    create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
  `);
  const insertSession = db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertSession.run('ses_export', 'project-1', '', '=SUM(1,1) 中文会话', path.join(os.homedir(), 'secret-project'), '26.6.2', now - 10000, now - 1000, null);
  insertSession.run('ses_internal', 'project-1', 'ses_export', 'Explore internals (@explore subagent)', path.join(os.homedir(), 'secret-project'), '26.6.2', now - 5000, now - 500, null);
  const insertMessage = db.prepare('insert into message values (?, ?, ?, ?, ?)');
  insertMessage.run('msg_user', 'ses_export', now - 9000, now - 9000, JSON.stringify({ role: 'user' }));
  insertMessage.run('msg_assistant', 'ses_export', now - 8000, now - 2000, JSON.stringify({ role: 'assistant', providerID: 'provider', modelID: 'model', time: { created: now - 8000, completed: now - 2000 }, tokens: { input: 100, output: 50, cache: { read: 10, write: 5 } } }));
  const insertPart = db.prepare('insert into part values (?, ?, ?, ?, ?, ?)');
  insertPart.run('part_user', 'msg_user', 'ses_export', now - 9000, now - 9000, JSON.stringify({ type: 'text', text: `请读取 ${path.join(os.homedir(), 'secret.txt')} 和 D:/corp/private/file.txt token=top-secret refresh_token=refresh-secret accessToken=access-secret AK=ak-secret SK=sk-secret\nprefix {"token":123456} suffix\npayload={"token":"abc\\\"TAIL_SECRET"}\n${JSON.stringify({ access_token: 'text-json-secret', session_token: 654321, token: 'whole-json-secret' })}\n\n\`\`\`js\nconsole.log('😀');\n\`\`\`\n${'长文本'.repeat(500)}` }));
  insertPart.run('part_synthetic', 'msg_user', 'ses_export', now - 8999, now - 8999, JSON.stringify({ type: 'text', text: '<system-reminder>INTERNAL_SYNTHETIC_PROMPT</system-reminder>', synthetic: true }));
  insertPart.run('part_reasoning', 'msg_assistant', 'ses_export', now - 7900, now - 7800, JSON.stringify({ type: 'reasoning', text: 'private reasoning' }));
  insertPart.run('part_tool', 'msg_assistant', 'ses_export', now - 7000, now - 6000, JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'completed', title: 'Read file', input: { file: 'D:/corp/private/tool.txt', token: 'tool-token-secret', refreshToken: 'tool-refresh-secret', nested: { apiKey: 'tool-api-secret', accountPassword: 'tool-password-secret' } }, output: JSON.stringify({ Authorization: 'Bearer tool-bearer-secret', AK: 'tool-ak-secret', SK: 'tool-sk-secret', private_key: 'tool-private-secret' }), error: `failure token=tool-error-secret at C:/Users/private-user/project/file.js ${'x'.repeat(700)}\nprivate-stack-frame`, time: { start: now - 7000, end: now - 6000 } } }));
  insertPart.run('part_finish', 'msg_assistant', 'ses_export', now - 2100, now - 2000, JSON.stringify({ type: 'step-finish', tokens: { input: 100, output: 50, cache: { read: 10, write: 5 } } }));
  insertPart.run('part_answer', 'msg_assistant', 'ses_export', now - 3000, now - 2000, JSON.stringify({ type: 'text', text: '已完成。' }));
  db.close();
}

function createPartialFixture(file, options = {}) {
  const db = new DatabaseSync(file);
  db.exec(`
    create table session (id text primary key, project_id text, parent_id text, title text, directory text, version text, time_created integer, time_updated integer, time_archived integer);
    create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    ${options.partTable === false ? '' : 'create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);'}
  `);
  db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('ses_partial', '', '', 'Partial fixture', 'D:/partial', '1', now - 1000, now, null);
  db.prepare('insert into message values (?, ?, ?, ?, ?)').run(
    'msg_partial',
    'ses_partial',
    now - 900,
    now - 100,
    options.invalidMessage
      ? '{invalid-message'
      : JSON.stringify(options.messageData || { role: 'assistant', providerID: 'provider', modelID: 'model', tokens: { input: 1, output: 1 } }),
  );
  if (options.partTable !== false) {
    db.prepare('insert into part values (?, ?, ?, ?, ?, ?)').run(
      'part_partial',
      'msg_partial',
      'ses_partial',
      now - 800,
      now - 100,
      options.invalidPart ? '{invalid-part' : JSON.stringify(options.partData || { type: 'text', text: 'partial fixture' }),
    );
  }
  db.close();
}

function createLargeFixture(file, requestCount = REQUEST_LOG_SAMPLE_LIMIT + 1) {
  const db = new DatabaseSync(file);
  db.exec(`
    create table session (id text primary key, project_id text, parent_id text, title text, directory text, version text, time_created integer, time_updated integer, time_archived integer);
    create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
  `);
  db.prepare('insert into session values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('ses_large', '', '', 'Large export fixture', 'D:/large', '1', now - requestCount * 10, now, null);
  const insertMessage = db.prepare('insert into message values (?, ?, ?, ?, ?)');
  const insertPart = db.prepare('insert into part values (?, ?, ?, ?, ?, ?)');
  db.exec('begin');
  try {
    for (let index = 0; index < requestCount; index += 1) {
      const id = `msg_large_${String(index).padStart(4, '0')}`;
      const createdAt = now - (requestCount - index) * 10;
      insertMessage.run(id, 'ses_large', createdAt, createdAt + 5, JSON.stringify({
        role: 'assistant', providerID: 'provider', modelID: 'large-model',
        time: { created: createdAt, completed: createdAt + 5 },
        tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      }));
      insertPart.run(`finish_large_${index}`, id, 'ses_large', createdAt + 5, createdAt + 5, JSON.stringify({
        type: 'step-finish', tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      }));
    }
    db.exec('commit');
  } catch (error) {
    db.exec('rollback');
    throw error;
  } finally {
    db.close();
  }
}

async function main() {
  createFixture();
  const options = { sessionId: 'ses_export', dbPath, useSavedSettings: false, timestamp: now };
  const native = await buildSessionExport(options);
  assertSchema(native);
  const invalidUnknownUsage = structuredClone(native);
  invalidUnknownUsage.usage.unstableField = 1;
  assert.equal(validateExport(invalidUnknownUsage), false, 'schema must reject unknown usage fields');
  const invalidModelUsage = structuredClone(native);
  invalidModelUsage.usage.models[0].unexpected = true;
  assert.equal(validateExport(invalidModelUsage), false, 'schema must reject unknown model usage fields');
  const invalidTopModel = structuredClone(native);
  invalidTopModel.usage.topModel = { model: 'incomplete' };
  assert.equal(validateExport(invalidTopModel), false, 'schema must reject structurally incomplete topModel values');
  assert.equal(native.schemaVersion, 1);
  assert.equal(native.completeness.complete, true);
  assert.equal(native.redaction.errorsIncluded, true);
  assert.equal(native.redaction.errorMode, 'redacted-summary');
  assert.equal(native.messages.length, 2);
  assert.equal(native.requests.length, 1);
  assert.equal(native.tools.length, 1);
  assert.equal(native.usage.total, 165);
  assert.ok(native.messages[0].content.includes('token=[redacted]'));
  assert.ok(native.messages[0].content.includes('~'));
  assert.doesNotMatch(JSON.stringify(native), /INTERNAL_SYNTHETIC_PROMPT/);
  for (const secret of ['refresh-secret', 'access-secret', 'ak-secret', 'sk-secret']) assert.doesNotMatch(JSON.stringify(native), new RegExp(secret));
  assert.match(native.messages[0].content, /```js/);
  assert.match(native.messages[0].content, /😀/);
  assert.equal(native.messages.some((item) => item.content.includes('private reasoning')), false);
  assert.equal(Object.hasOwn(native.tools[0], 'input'), false);
  assert.equal(Object.hasOwn(native.tools[0], 'output'), false);
  assert.equal(native.tools[0].error.includes('\n'), false);
  assert.equal(Array.from(native.tools[0].error).length, 500);
  assert.match(native.tools[0].error, /token=\[redacted\]/);
  assert.match(native.tools[0].error, /\[path\]/);
  assert.doesNotMatch(native.tools[0].error, /private-user|private-stack-frame|tool-error-secret/);

  const missingPartDb = path.join(work, 'missing-part.db');
  createPartialFixture(missingPartDb, { partTable: false });
  const missingPart = await buildSessionExport({ sessionId: 'ses_partial', dbPath: missingPartDb, useSavedSettings: false, timestamp: now });
  assertSchema(missingPart);
  assert.equal(missingPart.completeness.complete, false);
  assert.equal(missingPart.completeness.capabilities.partTable, false);
  assert.deepEqual(missingPart.completeness.reasons, ['part-table-missing']);

  const invalidJsonDb = path.join(work, 'invalid-json.db');
  createPartialFixture(invalidJsonDb, { invalidMessage: true, invalidPart: true });
  const invalidJson = await buildSessionExport({ sessionId: 'ses_partial', dbPath: invalidJsonDb, useSavedSettings: false, timestamp: now });
  assertSchema(invalidJson);
  assert.equal(invalidJson.completeness.complete, false);
  assert.deepEqual(invalidJson.completeness.parseFailures, { messages: 1, parts: 1 });
  assert.deepEqual(invalidJson.completeness.reasons, ['message-json-invalid', 'part-json-invalid']);
  assert.deepEqual(invalidJson.completeness.requiredFieldFailures, { session: 0, messages: 0, parts: 0 });

  const missingSessionId = normalizeExportModel({
    source: { id: 'custom', label: 'Custom', dbPath },
    session: { id: '', title: 'Missing ID', time_created: now - 100, time_updated: now },
    messages: [],
    parts: [],
    capabilities: { partTable: true },
  }, { timestamp: now });
  assertSchema(missingSessionId);
  assert.equal(missingSessionId.completeness.complete, false);
  assert.deepEqual(missingSessionId.completeness.reasons, ['session-required-fields-missing']);
  assert.deepEqual(missingSessionId.completeness.requiredFieldFailures, { session: 1, messages: 0, parts: 0 });

  const missingFieldsDb = path.join(work, 'missing-fields.db');
  createPartialFixture(missingFieldsDb, { messageData: { role: 'assistant' }, partData: { text: 'missing type' } });
  const missingFields = await buildSessionExport({ sessionId: 'ses_partial', dbPath: missingFieldsDb, useSavedSettings: false, timestamp: now });
  assertSchema(missingFields);
  assert.equal(missingFields.completeness.complete, false);
  assert.deepEqual(missingFields.completeness.requiredFieldFailures, { session: 0, messages: 1, parts: 1 });
  assert.deepEqual(missingFields.completeness.reasons, ['message-required-fields-missing', 'part-required-fields-missing']);

  const toolDetails = await buildSessionExport({ ...options, includeToolIO: true });
  assertSchema(toolDetails);
  const forbiddenExportValues = [
    'text-json-secret', 'tool-token-secret', 'tool-refresh-secret', 'tool-api-secret', 'tool-password-secret',
    'tool-bearer-secret', 'tool-ak-secret', 'tool-sk-secret', 'tool-private-secret', 'D:/corp/private', '123456', '654321', 'TAIL_SECRET', 'whole-json-secret',
  ];
  for (const format of ['json', 'md', 'xlsx']) {
    const serialized = await serializeSessionExport(toolDetails, format);
    let searchable = serialized.content.toString('utf8');
    if (format === 'xlsx') {
      const privateWorkbook = new ExcelJS.Workbook();
      await privateWorkbook.xlsx.load(serialized.content);
      searchable = JSON.stringify(privateWorkbook.worksheets.map((sheet) => sheet.getSheetValues()));
    }
    for (const secret of forbiddenExportValues) assert.equal(searchable.includes(secret), false, `${format} leaked ${secret}`);
  }

  process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
  const sqlJs = await buildSessionExport(options);
  assertSchema(sqlJs);
  delete process.env.CODEARTS_BAR_FORCE_SQLJS;
  assert.deepEqual(sqlJs, native, 'Native SQLite and SQL.js must produce the same normalized export model');

  for (const forceSqlJs of [false, true]) {
    if (forceSqlJs) process.env.CODEARTS_BAR_FORCE_SQLJS = '1';
    else delete process.env.CODEARTS_BAR_FORCE_SQLJS;
    await assert.rejects(
      () => buildSessionExport({ ...options, sessionId: 'ses_internal' }),
      (error) => error?.code === 'SESSION_EXPORT_INTERNAL_SESSION' && /内置子任务/.test(error.message),
    );
  }
  delete process.env.CODEARTS_BAR_FORCE_SQLJS;

  const json = await serializeSessionExport(native, 'json');
  const markdown = await serializeSessionExport(native, 'md');
  const xlsx = await serializeSessionExport(native, 'xlsx');
  assert.equal(JSON.parse(json.content.toString('utf8')).session.id, 'ses_export');
  assert.match(markdown.content.toString('utf8'), /^# =SUM\(1,1\) 中文会话/m);
  assert.doesNotMatch(markdown.content.toString('utf8'), /top-secret|tool-secret|private reasoning/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.content);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Messages', 'Requests', 'Tools']);
  assert.equal(workbook.getWorksheet('Summary').getCell('B3').value, "'=SUM(1,1) 中文会话");
  assert.equal(workbook.getWorksheet('Tools').columnCount, 9);

  const markdownFenceModel = structuredClone(native);
  markdownFenceModel.messages[0].content = 'before\n````js\ninside\n````\nafter';
  const fenceTokens = new MarkdownIt().parse((await serializeSessionExport(markdownFenceModel, 'md')).content.toString('utf8'), {});
  assert.ok(fenceTokens.some((token) => token.type === 'heading_open' && token.tag === 'h2'));
  assert.ok(fenceTokens.some((token) => token.type === 'inline' && token.content === '工具调用摘要'), 'sections after embedded fences must remain headings');

  for (const length of [32766, 32767, 32768, 40000]) {
    const longModel = structuredClone(native);
    longModel.messages[0].content = `${'文'.repeat(length)}😀`;
    const longWorkbook = new ExcelJS.Workbook();
    await longWorkbook.xlsx.load((await serializeSessionExport(longModel, 'xlsx')).content);
    const contentCells = longWorkbook.getWorksheet('Messages').getRows(2, longWorkbook.getWorksheet('Messages').rowCount - 1)
      .filter((row) => String(row.getCell(1).value || '').startsWith('msg_user'))
      .map((row) => row.getCell(6).value).filter(Boolean);
    assert.ok(contentCells.length >= (length > 32767 ? 2 : 1));
    assert.ok(contentCells.every((value) => String(value).length <= 32767), `Excel cell exceeded 32767 chars for ${length}`);
    assert.equal(contentCells.join('').endsWith('😀'), true, `Emoji was split for ${length}`);
  }

  const batchModel = await buildSessionBatchExport({ ...options, includeToolIO: true, sessions: [{ id: 'ses_export', dbPath }, { id: 'ses_internal', dbPath }] });
  assertSchema(batchModel);
  assert.equal(batchModel.completeness.sessions, 1);
  for (const format of ['json', 'md', 'xlsx']) {
    const serialized = await serializeSessionBatchExport(batchModel, format);
    assert.ok(serialized.content.length > 100);
    let searchable = serialized.content.toString('utf8');
    if (format === 'xlsx') {
      const privateWorkbook = new ExcelJS.Workbook();
      await privateWorkbook.xlsx.load(serialized.content);
      searchable = JSON.stringify(privateWorkbook.worksheets.map((sheet) => sheet.getSheetValues()));
    }
    for (const secret of forbiddenExportValues) assert.equal(searchable.includes(secret), false, `batch ${format} leaked ${secret}`);
  }
  const batchWorkbook = new ExcelJS.Workbook();
  await batchWorkbook.xlsx.load((await serializeSessionBatchExport(batchModel, 'xlsx')).content);
  assert.deepEqual(batchWorkbook.worksheets.map((sheet) => sheet.name), ['Sessions', 'Messages', 'Requests', 'Tools']);
  assert.equal(batchWorkbook.getWorksheet('Messages').getCell('A2').value, 'ses_export');
  assert.equal(batchWorkbook.getWorksheet('Requests').getCell('A2').value, 'ses_export');
  assert.equal(batchWorkbook.getWorksheet('Requests').getCell('H1').value, '错误类型');
  assert.equal(batchWorkbook.getWorksheet('Tools').getCell('A2').value, 'ses_export');

  const partialBatch = await buildSessionBatchExport({
    timestamp: now,
    useSavedSettings: false,
    sessions: [
      { id: 'ses_export', dbPath },
      { id: 'ses_partial', dbPath: missingPartDb },
      { id: 'ses_partial', dbPath: invalidJsonDb },
      { id: 'ses_partial', dbPath: missingFieldsDb },
    ],
  });
  assertSchema(partialBatch);
  assert.equal(partialBatch.completeness.complete, false);
  assert.deepEqual(partialBatch.completeness.reasons, [
    'part-table-missing',
    'message-json-invalid',
    'part-json-invalid',
    'message-required-fields-missing',
    'part-required-fields-missing',
  ]);
  assert.deepEqual(partialBatch.completeness.capabilities, { partTable: false });
  assert.deepEqual(partialBatch.completeness.parseFailures, { messages: 1, parts: 1 });
  assert.deepEqual(partialBatch.completeness.requiredFieldFailures, { session: 0, messages: 1, parts: 1 });

  const noDetails = await buildSessionExport({ ...options, includeContent: false, includeErrors: false });
  assert.ok(noDetails.messages.every((message) => message.content === '' && message.error === ''));
  assert.ok(noDetails.requests.every((request) => request.error === ''));
  assert.ok(noDetails.tools.every((tool) => tool.error === ''));
  assert.equal(noDetails.redaction.errorsIncluded, false);
  assert.equal(noDetails.redaction.errorMode, 'omitted');

  const largeDb = path.join(work, 'large.db');
  createLargeFixture(largeDb);
  const snapshot = await getSnapshotAsync({ dbPath: largeDb, timestamp: now, fixtureMode: true, useSavedSettings: false });
  assert.equal(snapshot.requestLog.length, REQUEST_LOG_SAMPLE_LIMIT);
  assert.equal(snapshot.requestLogSampled, true);
  assert.equal(snapshot.requestTotal, REQUEST_LOG_SAMPLE_LIMIT + 1);
  const largeExport = await buildSessionExport({ sessionId: 'ses_large', dbPath: largeDb, useSavedSettings: false, timestamp: now });
  assertSchema(largeExport);
  assert.equal(largeExport.messages.length, REQUEST_LOG_SAMPLE_LIMIT + 1);
  assert.equal(largeExport.requests.length, REQUEST_LOG_SAMPLE_LIMIT + 1);
  assert.equal(largeExport.completeness.requests, REQUEST_LOG_SAMPLE_LIMIT + 1);
  assert.equal(largeExport.completeness.sampled, false);
  assert.equal(largeExport.requests.at(-1).id, `msg_large_${String(REQUEST_LOG_SAMPLE_LIMIT).padStart(4, '0')}`);

  const deleted = new DatabaseSync(dbPath);
  deleted.prepare('delete from session where id = ?').run('ses_export');
  deleted.close();
  await assert.rejects(
    () => buildSessionExport(options),
    (error) => error?.code === 'SESSION_EXPORT_NOT_FOUND' && /会话已被删除|刷新会话列表/.test(error.message),
  );

  for (const format of ['json', 'md', 'xlsx']) {
    const outputPath = path.join(outputDir, `session.${format}`);
    const result = await exportSessionToFile({ ...options, model: native, format, outputPath });
    assert.equal(result.ok, true);
    assert.ok(fs.statSync(outputPath).size > 100);
  }
  assert.equal(safeFileStem('a<b>:c?. '), 'a_b__c_');
  assert.equal(safeFileStem('CON'), '_CON');
  assert.equal(Array.from(safeFileStem('😀'.repeat(120))).length, 100);
  const collision = path.join(outputDir, 'collision.json');
  fs.writeFileSync(collision, '{}');
  assert.equal(availableOutputPath(collision), path.join(outputDir, 'collision (2).json'));
  await assert.rejects(
    () => exportSessionToFile({ ...options, model: native, format: 'json', outputPath: outputDir }),
    (error) => error?.code === 'SESSION_EXPORT_WRITE_FAILED' && /目录权限和可用空间/.test(error.message),
  );
  fs.rmSync(work, { recursive: true, force: true });
  console.log('ok - session export json/markdown/xlsx native/sql.js privacy');
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { main };
