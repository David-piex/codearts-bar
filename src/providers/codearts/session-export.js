'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agg = require('../../core/aggregator');
const { redactSensitiveText, redactSensitiveValue } = require('../../core/sensitive-text');
const { writeFileAtomic } = require('../../core/atomic-file');
const { listDataSources, sourceMatchesPayload, validateTables, tagRows } = require('./sources');
const {
  openNativeDbReadonly,
  openSqlJsDbReadonly,
  nativeAll,
  nativeAllParams,
  sqlJsAll,
  sqlJsAllParams,
  closeDb,
} = require('./sqlite');
const { requestRowsFromMessages, sessionsFromRows } = require('./collect');
const { safeDbError } = require('./diagnostics');

const EXPORT_SCHEMA_VERSION = 1;
const ERROR_SUMMARY_MAX_LENGTH = 500;
const FORMATS = new Set(['json', 'md', 'xlsx']);
const COMPLETENESS_REASONS = Object.freeze({
  PART_TABLE_MISSING: 'part-table-missing',
  MESSAGE_JSON_INVALID: 'message-json-invalid',
  PART_JSON_INVALID: 'part-json-invalid',
  SESSION_REQUIRED_FIELDS_MISSING: 'session-required-fields-missing',
  MESSAGE_REQUIRED_FIELDS_MISSING: 'message-required-fields-missing',
  PART_REQUIRED_FIELDS_MISSING: 'part-required-fields-missing',
});

function exportError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { value: parsed, valid: true };
  } catch {}
  return { value: {}, valid: false };
}

function parseRowData(rows = []) {
  const values = new Map();
  const invalid = new Set();
  let failures = 0;
  for (const row of rows) {
    const parsed = parseJsonObject(row?.data);
    values.set(row, parsed.value);
    if (!parsed.valid) {
      invalid.add(row);
      failures += 1;
    }
  }
  return { values, invalid, failures };
}

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function requiredFieldFailures(session, messages = [], parts = [], parsedMessages = {}, parsedParts = {}) {
  const sessionFailures = present(session?.id) ? 0 : 1;
  let messageFailures = 0;
  let partFailures = 0;
  for (const row of messages) {
    if (parsedMessages.invalid?.has(row)) continue;
    const data = parsedMessages.values?.get(row) || {};
    const baseFieldsPresent = present(row?.id) && present(row?.session_id) && present(data.role);
    const assistantFieldsPresent = data.role !== 'assistant'
      || (present(data.providerID || data.model?.providerID) && present(data.modelID || data.model?.modelID));
    if (!baseFieldsPresent || !assistantFieldsPresent) messageFailures += 1;
  }
  for (const row of parts) {
    if (parsedParts.invalid?.has(row)) continue;
    const data = parsedParts.values?.get(row) || {};
    if (!present(row?.id) || !present(row?.message_id) || !present(row?.session_id) || !present(data.type)) partFailures += 1;
  }
  return { session: sessionFailures, messages: messageFailures, parts: partFailures };
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function iso(value) {
  const number = finite(value);
  return number == null || number <= 0 ? null : new Date(number).toISOString();
}

function redactLocalPath(value) {
  if (value == null || value === '') return '';
  let text = String(value);
  const home = os.homedir();
  if (home) text = text.replaceAll(home, '~').replaceAll(home.replace(/\\/g, '/'), '~');
  return text
    .replace(/(["'])(?:file:\/\/\/)?[A-Za-z]:[\\/][^\r\n"'<>|]*\1/gi, '$1[path]$1')
    .replace(/\b(?:file:\/\/\/)?[A-Za-z]:[\\/][^\s\r\n"'<>|,;)\]}]*/gi, '[path]')
    .replace(/(["'])\\\\[^\\/\s]+[\\/][^\r\n"'<>|]*\1/g, '$1[path]$1')
    .replace(/\\\\[^\\/\s]+[\\/][^\s\r\n"'<>|,;)\]}]*/g, '[path]')
    .replace(/(["'])\/(?!\/)[^\r\n"'<>|]*\1/g, '$1[path]$1')
    .replace(/(^|[\s("'=:\[])\/(?!\/)[^\s\r\n"'<>|,;)\]}]*/gm, '$1[path]');
}

function redact(value, options = {}) {
  let text = redactSensitiveText(value == null ? '' : String(value));
  if (options.redactPaths !== false) text = redactLocalPath(text);
  return text;
}

function errorText(value, options = {}) {
  if (options.includeErrors === false) return '';
  const firstLine = redact(value, options).split(/\r?\n/, 1)[0];
  return Array.from(firstLine).slice(0, ERROR_SUMMARY_MAX_LENGTH).join('');
}

function messageContent(data = {}, parts = [], options = {}, partData = null) {
  if (options.includeContent === false) return '';
  const texts = [];
  for (const row of parts) {
    const part = partData?.get(row) || parseJson(row.data, {});
    if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
    if (options.includeReasoning === true && part.type === 'reasoning' && typeof part.text === 'string') texts.push(part.text);
  }
  if (!texts.length && typeof data.content === 'string') texts.push(data.content);
  if (!texts.length && Array.isArray(data.content)) {
    for (const item of data.content) {
      if (typeof item === 'string') texts.push(item);
      else if (item && typeof item.text === 'string') texts.push(item.text);
    }
  }
  return redact(texts.join('\n\n'), options);
}

function toolRecord(row, options = {}, parsedData = null) {
  const data = parsedData || parseJson(row.data, {});
  const state = data.state || {};
  const start = finite(state.time?.start, finite(row.time_created));
  const end = finite(state.time?.end, state.status === 'running' ? null : finite(row.time_updated));
  const out = {
    id: String(row.id || ''),
    messageId: String(row.message_id || ''),
    name: redact(data.tool || data.toolName || data.name || 'unknown', options),
    title: redact(state.title || '', options),
    status: String(state.status || 'unknown'),
    startedAt: iso(start),
    endedAt: iso(end),
    durationMs: start != null && end != null && end >= start ? end - start : null,
    error: errorText(state.error || '', options),
  };
  if (options.includeToolIO === true) {
    out.input = redact(typeof state.input === 'string' ? state.input : JSON.stringify(redactSensitiveValue(state.input ?? null)), options);
    out.output = redact(typeof state.output === 'string' ? state.output : JSON.stringify(redactSensitiveValue(state.output ?? null)), options);
  }
  return out;
}

function normalizeExportModel(rows, options = {}) {
  const { source, session, messages, parts } = rows;
  const taggedSession = tagRows([session], source)[0];
  const taggedMessages = tagRows(messages, source);
  const taggedParts = tagRows(parts, source);
  const parsedMessages = parseRowData(taggedMessages);
  const parsedParts = parseRowData(taggedParts);
  const requiredFailures = requiredFieldFailures(session, taggedMessages, taggedParts, parsedMessages, parsedParts);
  const partMap = agg.buildPartMap(taggedParts);
  const partsByMessage = new Map();
  for (const row of taggedParts) {
    const list = partsByMessage.get(row.message_id) || [];
    list.push(row);
    partsByMessage.set(row.message_id, list);
  }
  const normalizedMessages = taggedMessages.map((row) => {
    const data = parsedMessages.values.get(row) || {};
    const messageParts = partsByMessage.get(row.id) || [];
    const token = agg.tokenForMessage(row, partMap);
    return {
      id: String(row.id || ''),
      role: String(data.role || 'unknown'),
      provider: String(data.providerID || data.model?.providerID || 'unknown'),
      model: String(data.modelID || data.model?.modelID || 'unknown'),
      createdAt: iso(row.time_created),
      updatedAt: iso(row.time_updated),
      content: messageContent(data, messageParts, options, parsedParts.values),
      error: errorText(agg.extractError(data)?.message || '', options),
      usage: token,
    };
  });
  const tools = taggedParts
    .filter((row) => parsedParts.values.get(row)?.type === 'tool')
    .map((row) => toolRecord(row, options, parsedParts.values.get(row)));
  const sessionInfo = sessionsFromRows([taggedSession], taggedMessages, taggedParts, finite(options.timestamp, Date.now()))[0];
  const messageDataById = new Map(taggedMessages.map((row) => [row.id, parsedMessages.values.get(row) || {}]));
  const requests = requestRowsFromMessages(taggedMessages, [taggedSession], taggedParts).map((item) => ({
    id: item.id,
    messageId: item.id,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
    provider: item.provider,
    model: item.model,
    status: item.status,
    ok: item.ok,
    errorType: redact(agg.extractError(messageDataById.get(item.id) || {})?.name || '', options),
    error: errorText(item.error || '', options),
    latencyMs: finite(item.latencyMs),
    ttftMs: finite(item.ttftMs),
    firstContentMs: finite(item.firstContentMs),
    outputTokensPerSec: finite(item.outputTokensPerSec),
    total: finite(item.total, 0),
    input: finite(item.input, 0),
    output: finite(item.output, 0),
    reasoning: finite(item.reasoning, 0),
    cacheRead: finite(item.cacheRead, 0),
    cacheWrite: finite(item.cacheWrite, 0),
  }));
  const partTable = rows.capabilities?.partTable !== false;
  const incompleteReasons = [];
  if (!partTable) incompleteReasons.push(COMPLETENESS_REASONS.PART_TABLE_MISSING);
  if (parsedMessages.failures) incompleteReasons.push(COMPLETENESS_REASONS.MESSAGE_JSON_INVALID);
  if (parsedParts.failures) incompleteReasons.push(COMPLETENESS_REASONS.PART_JSON_INVALID);
  if (requiredFailures.session) incompleteReasons.push(COMPLETENESS_REASONS.SESSION_REQUIRED_FIELDS_MISSING);
  if (requiredFailures.messages) incompleteReasons.push(COMPLETENESS_REASONS.MESSAGE_REQUIRED_FIELDS_MISSING);
  if (requiredFailures.parts) incompleteReasons.push(COMPLETENESS_REASONS.PART_REQUIRED_FIELDS_MISSING);
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(finite(options.timestamp, Date.now())).toISOString(),
    source: { id: source.id, label: source.label },
    session: {
      id: String(session.id || ''),
      title: redact(session.title || '无标题会话', options),
      directory: redact(session.directory || '', options),
      projectId: String(session.project_id || ''),
      parentId: String(session.parent_id || ''),
      version: String(session.version || ''),
      createdAt: iso(session.time_created),
      updatedAt: iso(session.time_updated),
      archivedAt: iso(session.time_archived),
      usage: sessionInfo?.usage || {},
    },
    usage: sessionInfo?.usage || {},
    messages: normalizedMessages,
    requests,
    tools,
    completeness: {
      complete: incompleteReasons.length === 0,
      sampled: false,
      messages: normalizedMessages.length,
      requests: requests.length,
      tools: tools.length,
      reasons: incompleteReasons,
      capabilities: { partTable },
      parseFailures: { messages: parsedMessages.failures, parts: parsedParts.failures },
      requiredFieldFailures: requiredFailures,
    },
    redaction: {
      secrets: true,
      localPaths: options.redactPaths !== false,
      contentIncluded: options.includeContent !== false,
      reasoningIncluded: options.includeReasoning === true,
      toolIOIncluded: options.includeToolIO === true,
      errorsIncluded: options.includeErrors !== false,
      errorMode: options.includeErrors === false ? 'omitted' : 'redacted-summary',
    },
  };
}

function readOne(queryAll, db, source, sessionId) {
  const tables = queryAll(db, "select name from sqlite_master where type='table'", []).map((row) => row.name);
  validateTables(tables);
  const session = queryAll(db, 'select * from session where id = ? limit 1', [sessionId])[0];
  if (!session) return null;
  const messages = queryAll(db, 'select id, session_id, time_created, time_updated, data from message where session_id = ? order by time_created asc, id asc', [sessionId]);
  const partTable = tables.includes('part');
  const parts = partTable
    ? queryAll(db, 'select id, message_id, session_id, time_created, time_updated, data from part where session_id = ? order by time_created asc, id asc', [sessionId])
    : [];
  return { source, session, messages, parts, capabilities: { partTable } };
}

function matchingSources(options = {}) {
  return listDataSources(options).filter((source) => sourceMatchesPayload(source, options));
}

function readSessionNative(options = {}) {
  const sessionId = String(options.sessionId || options.id || '').trim();
  if (!sessionId) throw exportError('SESSION_EXPORT_ID_REQUIRED', '缺少会话 ID');
  for (const source of matchingSources(options)) {
    const db = openNativeDbReadonly(source.dbPath);
    try {
      const rows = readOne(nativeAllParams, db, source, sessionId);
      if (rows) return rows;
    } finally { closeDb(db); }
  }
  throw exportError('SESSION_EXPORT_NOT_FOUND', '会话已被删除或不再存在，请刷新会话列表后重试');
}

async function readSessionSqlJs(options = {}) {
  const sessionId = String(options.sessionId || options.id || '').trim();
  if (!sessionId) throw exportError('SESSION_EXPORT_ID_REQUIRED', '缺少会话 ID');
  for (const source of matchingSources(options)) {
    const db = await openSqlJsDbReadonly(source.dbPath);
    try {
      const rows = readOne(sqlJsAllParams, db, source, sessionId);
      if (rows) return rows;
    } finally { closeDb(db); }
  }
  throw exportError('SESSION_EXPORT_NOT_FOUND', '会话已被删除或不再存在，请刷新会话列表后重试');
}

async function buildSessionExport(options = {}) {
  let rows;
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { rows = readSessionNative(options); }
    catch (error) {
      if (error?.code === 'SESSION_EXPORT_ID_REQUIRED' || error?.code === 'SESSION_EXPORT_NOT_FOUND') throw error;
      try { rows = await readSessionSqlJs(options); }
      catch (fallbackError) {
        if (fallbackError?.code === 'SESSION_EXPORT_ID_REQUIRED' || fallbackError?.code === 'SESSION_EXPORT_NOT_FOUND') throw fallbackError;
        throw exportError('SESSION_EXPORT_READ_FAILED', safeDbError(error), error);
      }
    }
  } else rows = await readSessionSqlJs(options);
  return normalizeExportModel(rows, options);
}

async function buildSessionBatchExport(options = {}) {
  const sessions = Array.isArray(options.sessions) ? options.sessions : [];
  if (!sessions.length) throw new Error('请选择至少一个要导出的会话');
  const models = [];
  for (const session of sessions) {
    models.push(await buildSessionExport({
      ...options,
      sessionId: session?.id || session?.sessionId,
      source: session?.source,
      dbPath: session?.dbPath,
    }));
  }
  const exportedAt = new Date(finite(options.timestamp, Date.now())).toISOString();
  const completenessReasons = [...new Set(models.flatMap((model) => model.completeness.reasons || []))];
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    kind: 'session-batch',
    exportedAt,
    sessions: models,
    completeness: {
      complete: models.every((model) => model.completeness.complete),
      sampled: models.some((model) => model.completeness.sampled),
      sessions: models.length,
      messages: models.reduce((sum, model) => sum + model.messages.length, 0),
      requests: models.reduce((sum, model) => sum + model.requests.length, 0),
      tools: models.reduce((sum, model) => sum + model.tools.length, 0),
      reasons: completenessReasons,
      capabilities: { partTable: models.every((model) => model.completeness.capabilities?.partTable !== false) },
      parseFailures: {
        messages: models.reduce((sum, model) => sum + Number(model.completeness.parseFailures?.messages || 0), 0),
        parts: models.reduce((sum, model) => sum + Number(model.completeness.parseFailures?.parts || 0), 0),
      },
      requiredFieldFailures: {
        session: models.reduce((sum, model) => sum + Number(model.completeness.requiredFieldFailures?.session || 0), 0),
        messages: models.reduce((sum, model) => sum + Number(model.completeness.requiredFieldFailures?.messages || 0), 0),
        parts: models.reduce((sum, model) => sum + Number(model.completeness.requiredFieldFailures?.parts || 0), 0),
      },
    },
    redaction: { ...models[0].redaction },
  };
}

function markdownEscape(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function localTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function fenced(value, language = '') {
  const text = String(value == null ? '' : value);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function renderMarkdown(model, options = {}) {
  const h = '#'.repeat(Math.max(1, Math.min(4, Number(options.headingLevel || 1))));
  const lines = [
    `${h} ${model.session.title}`,
    '',
    `${h}# 元数据`,
    '',
    '| 字段 | 值 |',
    '| --- | --- |',
    `| 会话 ID | \`${markdownEscape(model.session.id)}\` |`,
    `| 数据源 | ${markdownEscape(model.source.label)} |`,
    `| 模型调用 | ${Number(model.usage.modelCalls || 0)} |`,
    `| 总 Token | ${Number(model.usage.total || 0)} |`,
    `| 创建时间 | ${localTime(model.session.createdAt)} |`,
    `| 更新时间 | ${localTime(model.session.updatedAt)} |`,
    `| 工作目录 | \`${markdownEscape(model.session.directory || '未记录')}\` |`,
    '',
    `${h}# 使用摘要`,
    '',
    `- 输入 Token：${Number(model.usage.input || 0)}`,
    `- 输出 Token：${Number(model.usage.output || 0)}`,
    `- 推理 Token：${Number(model.usage.reasoning || 0)}`,
    `- 缓存读取：${Number(model.usage.cacheRead || 0)}`,
    `- 错误：${Number(model.usage.errors || 0)}`,
    '',
    `${h}# 对话记录`,
    '',
  ];
  for (const message of model.messages) {
    const role = ({ user: '用户', assistant: '助手', system: '系统', tool: '工具' })[message.role] || message.role;
    lines.push(`${h}## ${role} · ${localTime(message.createdAt)}`, '');
    if (message.model && message.model !== 'unknown') lines.push(`模型：\`${markdownEscape(message.model)}\``, '');
    lines.push(message.content || '_无文本内容_', '');
    if (message.error) lines.push(`> 错误：${message.error.replace(/\r?\n/g, ' ')}`, '');
  }
  lines.push(`${h}# 工具调用摘要`, '', '| 工具 | 状态 | 耗时 |', '| --- | --- | ---: |');
  for (const tool of model.tools) {
    lines.push(`| ${markdownEscape(tool.name)} | ${markdownEscape(tool.status)} | ${tool.durationMs == null ? '' : `${tool.durationMs}ms`} |`);
  }
  if (!model.tools.length) lines.push('| 无 |  |  |');
  if (model.redaction.toolIOIncluded) {
    lines.push('', `${h}# 工具输入输出`, '');
    for (const tool of model.tools) {
      lines.push(`${h}## ${tool.name}`, '', '**输入**', '', fenced(tool.input || '', 'json'), '', '**输出**', '', fenced(tool.output || ''), '');
    }
  }
  const errors = [...model.messages.filter((item) => item.error).map((item) => item.error), ...model.tools.filter((item) => item.error).map((item) => item.error)];
  lines.push('', `${h}# 错误与诊断`, '', errors.length ? errors.map((error) => `- ${String(error).replace(/\r?\n/g, ' ')}`).join('\n') : '- 未记录错误', '');
  lines.push(`${h}# 导出说明`, '', `- Schema：${model.schemaVersion}`, `- 完整数据：${model.completeness.complete ? '是' : '否'}`, `- 本机路径脱敏：${model.redaction.localPaths ? '是' : '否'}`, `- 工具输入输出：${model.redaction.toolIOIncluded ? '包含' : '未包含'}`, '');
  return lines.join('\n');
}

function renderBatchMarkdown(batch) {
  const lines = ['# CodeArts 会话批量导出', '', `- 导出时间：${localTime(batch.exportedAt)}`, `- 会话数：${batch.sessions.length}`, `- 完整数据：${batch.completeness.complete ? '是' : '否'}`, ''];
  for (const model of batch.sessions) lines.push('---', '', renderMarkdown(model, { headingLevel: 2 }), '');
  return lines.join('\n');
}

function safeCell(value) {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

const EXCEL_CELL_MAX = 32767;

function splitExcelText(value, maxLength = EXCEL_CELL_MAX) {
  const text = String(value == null ? '' : value);
  if (text.length <= maxLength) return [safeCell(text)];
  const chunks = [];
  let chunk = '';
  for (const codePoint of text) {
    if (chunk.length + codePoint.length > maxLength) { chunks.push(safeCell(chunk)); chunk = ''; }
    chunk += codePoint;
  }
  if (chunk || !chunks.length) chunks.push(safeCell(chunk));
  return chunks;
}

function addExcelRowsWithContinuation(sheet, row, longColumns = []) {
  const split = new Map(longColumns.map((index) => [index, splitExcelText(row[index])]));
  const count = Math.max(1, ...[...split.values()].map((chunks) => chunks.length));
  for (let part = 0; part < count; part++) {
    sheet.addRow(row.map((value, index) => split.has(index)
      ? split.get(index)[part] || ''
      : part === 0 ? value : index === 0 ? `${value} (续 ${part + 1})` : ''));
  }
}

function styleWorksheet(sheet, widths = []) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = sheet.rowCount ? { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } } : undefined;
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0969C3' } };
  header.alignment = { vertical: 'middle' };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (const row of sheet.eachRow ? Array.from({ length: sheet.rowCount }, (_, index) => sheet.getRow(index + 1)) : []) {
    row.alignment = { vertical: 'top', wrapText: true };
  }
}

async function renderExcel(model) {
  const ExcelJS = require('../../vendor/session-xlsx');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CodeArts Bar';
  workbook.created = new Date(model.exportedAt);
  const summary = workbook.addWorksheet('Summary');
  summary.addRows([
    ['字段', '值'], ['会话 ID', safeCell(model.session.id)], ['标题', safeCell(model.session.title)],
    ['数据源', safeCell(model.source.label)], ['项目 ID', safeCell(model.session.projectId)], ['父会话 ID', safeCell(model.session.parentId)],
    ['工作目录', safeCell(model.session.directory)], ['创建时间', model.session.createdAt || ''], ['更新时间', model.session.updatedAt || ''],
    ['总 Token', Number(model.usage.total || 0)], ['输入 Token', Number(model.usage.input || 0)], ['输出 Token', Number(model.usage.output || 0)],
    ['缓存读取', Number(model.usage.cacheRead || 0)], ['缓存写入', Number(model.usage.cacheWrite || 0)], ['请求数', Number(model.usage.modelCalls || 0)],
    ['主要模型', safeCell(model.usage.topModel?.model || '未知')], ['数据完整', model.completeness.complete], ['已采样', model.completeness.sampled],
    ['错误数', Number(model.usage.errors || 0)], ['消息数', model.messages.length], ['工具数', model.tools.length],
  ]);
  styleWorksheet(summary, [22, 72]);
  const messages = workbook.addWorksheet('Messages');
  messages.addRow(['ID', '时间', '角色', 'Provider', '模型', '正文', '错误', '总 Token', '输入', '输出', '推理', '缓存读', '缓存写']);
  for (const item of model.messages) addExcelRowsWithContinuation(messages, [safeCell(item.id), item.createdAt || '', safeCell(item.role), safeCell(item.provider), safeCell(item.model), safeCell(item.content), safeCell(item.error), item.usage.total || 0, item.usage.input || 0, item.usage.output || 0, item.usage.reasoning || 0, item.usage.cacheRead || 0, item.usage.cacheWrite || 0], [5, 6]);
  styleWorksheet(messages, [24, 24, 12, 18, 24, 72, 36, 14, 12, 12, 12, 12, 12]);
  const requests = workbook.addWorksheet('Requests');
  requests.addRow(['ID', '时间', 'Provider', '模型', '状态', '成功', '错误类型', '错误', '总 Token', '输入', '输出', '推理', '缓存读', '缓存写', '延迟(ms)', 'TTFT(ms)', '首内容(ms)', '输出速度']);
  for (const item of model.requests) addExcelRowsWithContinuation(requests, [safeCell(item.id), item.createdAt || '', safeCell(item.provider), safeCell(item.model), safeCell(item.status), item.ok, safeCell(item.errorType), safeCell(item.error), item.total, item.input, item.output, item.reasoning, item.cacheRead, item.cacheWrite, item.latencyMs, item.ttftMs, item.firstContentMs, item.outputTokensPerSec], [7]);
  styleWorksheet(requests, [24, 24, 18, 24, 12, 10, 18, 36, 14, 12, 12, 12, 12, 12, 14, 14, 14, 14]);
  const tools = workbook.addWorksheet('Tools');
  const toolHeaders = ['ID', '消息 ID', '工具', '标题', '状态', '开始时间', '结束时间', '耗时(ms)', '错误'];
  if (model.redaction.toolIOIncluded) toolHeaders.push('输入', '输出');
  tools.addRow(toolHeaders);
  for (const item of model.tools) {
    const row = [safeCell(item.id), safeCell(item.messageId), safeCell(item.name), safeCell(item.title), safeCell(item.status), item.startedAt || '', item.endedAt || '', item.durationMs, safeCell(item.error)];
    if (model.redaction.toolIOIncluded) row.push(safeCell(item.input), safeCell(item.output));
    addExcelRowsWithContinuation(tools, row, model.redaction.toolIOIncluded ? [9, 10] : [8]);
  }
  styleWorksheet(tools, model.redaction.toolIOIncluded ? [24, 24, 22, 28, 12, 24, 24, 14, 36, 60, 60] : [24, 24, 22, 28, 12, 24, 24, 14, 36]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function renderBatchExcel(batch) {
  const ExcelJS = require('../../vendor/session-xlsx');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CodeArts Bar';
  workbook.created = new Date(batch.exportedAt);
  const sessions = workbook.addWorksheet('Sessions');
  sessions.addRow(['Session ID', '标题', '数据源', '项目 ID', '工作目录', '创建时间', '更新时间', '总 Token', '输入', '输出', '推理', '缓存读', '缓存写', '请求', '错误', '消息', '工具', '完整']);
  for (const model of batch.sessions) sessions.addRow([
    safeCell(model.session.id), safeCell(model.session.title), safeCell(model.source.label), safeCell(model.session.projectId), safeCell(model.session.directory),
    model.session.createdAt || '', model.session.updatedAt || '', model.usage.total || 0, model.usage.input || 0, model.usage.output || 0,
    model.usage.reasoning || 0, model.usage.cacheRead || 0, model.usage.cacheWrite || 0, model.usage.modelCalls || 0, model.usage.errors || 0,
    model.messages.length, model.tools.length, model.completeness.complete,
  ]);
  styleWorksheet(sessions, [26, 36, 18, 24, 55, 24, 24, 14, 12, 12, 12, 12, 12, 12, 12, 12, 12, 10]);
  const messages = workbook.addWorksheet('Messages');
  messages.addRow(['Session ID', 'Message ID', '时间', '角色', 'Provider', '模型', '正文', '错误', '总 Token', '输入', '输出', '推理', '缓存读', '缓存写']);
  const requests = workbook.addWorksheet('Requests');
  requests.addRow(['Session ID', 'Request ID', '时间', 'Provider', '模型', '状态', '成功', '错误类型', '错误', '总 Token', '输入', '输出', '推理', '缓存读', '缓存写', '延迟(ms)', 'TTFT(ms)', '首内容(ms)', '输出速度']);
  const tools = workbook.addWorksheet('Tools');
  const toolHeaders = ['Session ID', 'Tool ID', 'Message ID', '工具', '标题', '状态', '开始时间', '结束时间', '耗时(ms)', '错误'];
  if (batch.redaction.toolIOIncluded) toolHeaders.push('输入', '输出');
  tools.addRow(toolHeaders);
  for (const model of batch.sessions) {
    const sessionId = safeCell(model.session.id);
    for (const item of model.messages) addExcelRowsWithContinuation(messages, [sessionId, safeCell(item.id), item.createdAt || '', safeCell(item.role), safeCell(item.provider), safeCell(item.model), safeCell(item.content), safeCell(item.error), item.usage.total || 0, item.usage.input || 0, item.usage.output || 0, item.usage.reasoning || 0, item.usage.cacheRead || 0, item.usage.cacheWrite || 0], [6, 7]);
    for (const item of model.requests) addExcelRowsWithContinuation(requests, [sessionId, safeCell(item.id), item.createdAt || '', safeCell(item.provider), safeCell(item.model), safeCell(item.status), item.ok, safeCell(item.errorType), safeCell(item.error), item.total, item.input, item.output, item.reasoning, item.cacheRead, item.cacheWrite, item.latencyMs, item.ttftMs, item.firstContentMs, item.outputTokensPerSec], [8]);
    for (const item of model.tools) {
      const row = [sessionId, safeCell(item.id), safeCell(item.messageId), safeCell(item.name), safeCell(item.title), safeCell(item.status), item.startedAt || '', item.endedAt || '', item.durationMs, safeCell(item.error)];
      if (batch.redaction.toolIOIncluded) row.push(safeCell(item.input), safeCell(item.output));
      addExcelRowsWithContinuation(tools, row, batch.redaction.toolIOIncluded ? [10, 11] : [9]);
    }
  }
  styleWorksheet(messages, [26, 24, 24, 12, 18, 24, 72, 36, 14, 12, 12, 12, 12, 12]);
  styleWorksheet(requests, [26, 24, 24, 18, 24, 12, 10, 22, 36, 14, 12, 12, 12, 12, 12, 14, 14, 14, 14]);
  styleWorksheet(tools, batch.redaction.toolIOIncluded ? [26, 24, 24, 22, 28, 12, 24, 24, 14, 36, 60, 60] : [26, 24, 24, 22, 28, 12, 24, 24, 14, 36]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function safeFileStem(value) {
  const text = String(value || 'codearts-session').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  const stem = Array.from(text || 'codearts-session').slice(0, 100).join('');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? `_${stem}` : stem;
}

function availableOutputPath(file) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 2; index < 10000; index++) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('无法为导出文件生成不重复的文件名');
}

function writeExportFile(outputPath, content) {
  try { writeFileAtomic(outputPath, content, { encoding: undefined }); }
  catch (error) {
    const wrapped = new Error(`无法写入导出文件${error?.code ? `（${error.code}）` : ''}，请检查目录权限和可用空间`);
    wrapped.code = 'SESSION_EXPORT_WRITE_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

async function serializeSessionExport(model, format) {
  const normalized = String(format || 'json').toLowerCase();
  if (!FORMATS.has(normalized)) throw new Error(`不支持的导出格式：${normalized}`);
  if (normalized === 'json') return { format: normalized, extension: 'json', content: Buffer.from(`${JSON.stringify(model, null, 2)}\n`, 'utf8') };
  if (normalized === 'md') return { format: normalized, extension: 'md', content: Buffer.from(renderMarkdown(model), 'utf8') };
  return { format: normalized, extension: 'xlsx', content: await renderExcel(model) };
}

async function exportSessionToFile(options = {}) {
  const model = options.model || await buildSessionExport(options);
  const serialized = await serializeSessionExport(model, options.format);
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : availableOutputPath(path.join(process.cwd(), `${safeFileStem(model.session.title)}.${serialized.extension}`));
  writeExportFile(outputPath, serialized.content);
  return { ok: true, path: outputPath, format: serialized.format, bytes: serialized.content.length, model };
}

async function serializeSessionBatchExport(batch, format) {
  const normalized = String(format || 'json').toLowerCase();
  if (!FORMATS.has(normalized)) throw new Error(`不支持的导出格式：${normalized}`);
  if (normalized === 'json') return { format: normalized, extension: 'json', content: Buffer.from(`${JSON.stringify(batch, null, 2)}\n`, 'utf8') };
  if (normalized === 'md') return { format: normalized, extension: 'md', content: Buffer.from(renderBatchMarkdown(batch), 'utf8') };
  return { format: normalized, extension: 'xlsx', content: await renderBatchExcel(batch) };
}

async function exportSessionsToFile(options = {}) {
  const model = options.model || await buildSessionBatchExport(options);
  const serialized = await serializeSessionBatchExport(model, options.format);
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : availableOutputPath(path.join(process.cwd(), `codearts-sessions.${serialized.extension}`));
  writeExportFile(outputPath, serialized.content);
  return { ok: true, path: outputPath, format: serialized.format, bytes: serialized.content.length, model };
}

module.exports = {
  EXPORT_SCHEMA_VERSION,
  FORMATS,
  COMPLETENESS_REASONS,
  redactLocalPath,
  normalizeExportModel,
  buildSessionExport,
  buildSessionBatchExport,
  renderMarkdown,
  renderBatchMarkdown,
  renderExcel,
  renderBatchExcel,
  safeFileStem,
  availableOutputPath,
  serializeSessionExport,
  serializeSessionBatchExport,
  exportSessionToFile,
  exportSessionsToFile,
};
