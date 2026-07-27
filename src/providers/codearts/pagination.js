'use strict';

const { listDataSources, validateTables, sourceMatchesPayload, pageBounds, assistantWhere, sessionWhere, tagRows, tableColumnNames } = require('./sources');
const { safeDbError } = require('./diagnostics');
const { openNativeDbReadonly, openSqlJsDbReadonly, nativeAll, nativeAllParams, sqlJsAll, sqlJsAllParams, closeDb } = require('./sqlite');
const { requestRowsFromMessages, sessionsFromRows, queryPartsForMessages, querySessionsByIds, queryMessagesForSessions } = require('./collect');

const ONE_SHOT_RUNTIME = typeof CODEARTS_BAR_ONE_SHOT_RUNTIME !== 'undefined' && CODEARTS_BAR_ONE_SHOT_RUNTIME;
function runNativePageWorker(operation, payload) {
  const moduleName = './native-' + 'worker-pool';
  return require(moduleName).runNativeWorker(operation, payload);
}

function decodeCursor(value) {
  if (!value) return null;
  if (value && typeof value === 'object') {
    const sortValue = Number(value.sortValue ?? value.time ?? value.updatedAt ?? value.createdAt);
    return Number.isFinite(sortValue) && value.id ? { sortValue, source: String(value.source || ''), id: String(value.id) } : null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return decodeCursor(parsed);
  } catch { return null; }
}
function encodeCursor(row, sortKey) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ sortValue: Number(row[sortKey] || 0), source: String(row.source || ''), id: String(row.id || '') }), 'utf8').toString('base64url');
}
function cursorWhere(where, params, source, cursor, sortColumn) {
  if (!cursor) return { where, params };
  const sourceOrder = String(source.id || '').localeCompare(cursor.source);
  if (sourceOrder < 0) return { where: `(${where}) and ${sortColumn} < ?`, params: [...params, cursor.sortValue] };
  if (sourceOrder > 0) return { where: `(${where}) and ${sortColumn} <= ?`, params: [...params, cursor.sortValue] };
  return {
    where: `(${where}) and (${sortColumn} < ? or (${sortColumn} = ? and id < ?))`,
    params: [...params, cursor.sortValue, cursor.sortValue, cursor.id],
  };
}
function pageResult(items, total, payload, defaultLimit, extra = {}) {
  const { limit, offset } = pageBounds(payload, defaultLimit);
  return { ok: true, limit, offset: decodeCursor(payload.cursor) ? 0 : offset, total, hasMore: offset + items.length < total, items, ...extra };
}
function paginationBatchSize(limit) {
  return Math.max(80, Math.min(500, Number(limit || 100) * 2));
}
function sourceContexts(payload, openDb, schemaQuery, queryAll) {
  const contexts = [];
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = openDb(source.dbPath);
      const tables = schemaQuery(db).map((r) => r.name);
      validateTables(tables);
      contexts.push({ source, db, tables, sessionColumns: tableColumnNames(queryAll, db, 'session') });
    } catch (error) {
      closeDb(db);
      throw new Error(safeDbError(error));
    }
  }
  return contexts;
}
async function sourceContextsAsync(payload, openDb, schemaQuery, queryAll) {
  const contexts = [];
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = await openDb(source.dbPath);
      const tables = schemaQuery(db).map((r) => r.name);
      validateTables(tables);
      contexts.push({ source, db, tables, sessionColumns: tableColumnNames(queryAll, db, 'session') });
    } catch (error) {
      closeDb(db);
      throw new Error(safeDbError(error));
    }
  }
  return contexts;
}
function closeContexts(contexts = []) {
  for (const ctx of contexts) closeDb(ctx.db);
}
function makeRequestState(ctx, payload, queryAll, batchSize) {
  const { source, db, tables } = ctx;
  const base = assistantWhere(payload, { hasPart: tables.includes('part'), excludePlaceholders: true, outerAlias: 'message' });
  const total = Number(queryAll(db, `select count(*) as count from message where ${base.where}`, base.params)[0]?.count || 0);
  const { where, params } = cursorWhere(base.where, base.params, source, decodeCursor(payload.cursor), 'time_created');
  return {
    payload,
    total,
    nextOffset: 0,
    fetched: 0,
    buffer: [],
    exhausted: total <= 0,
    loadBatch() {
      if (this.exhausted) return;
      const rawMessages = queryAll(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc, id desc limit ? offset ?`, [...params, batchSize, this.nextOffset]);
      this.nextOffset += rawMessages.length;
      this.fetched += rawMessages.length;
      if (!rawMessages.length || this.nextOffset >= total) this.exhausted = true;
      this.buffer.push(...tagRows(rawMessages, source).map((row) => ({ ...row, __paginationState: this.index })));
    },
  };
}
function makeSessionState(ctx, payload, queryAll, batchSize) {
  const { source, db, tables, sessionColumns } = ctx;
  const base = sessionWhere(payload, { sessionColumns });
  const total = Number(queryAll(db, `select count(*) as count from session where ${base.where}`, base.params)[0]?.count || 0);
  const { where, params } = cursorWhere(base.where, base.params, source, decodeCursor(payload.cursor), 'time_updated');
  return {
    payload,
    total,
    nextOffset: 0,
    fetched: 0,
    buffer: [],
    exhausted: total <= 0,
    loadBatch() {
      if (this.exhausted) return;
      const rawSessions = queryAll(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc, id desc limit ? offset ?`, [...params, batchSize, this.nextOffset]);
      this.nextOffset += rawSessions.length;
      this.fetched += rawSessions.length;
      if (!rawSessions.length || this.nextOffset >= total) this.exhausted = true;
      this.buffer.push(...tagRows(rawSessions, source).map((row) => ({ ...row, __paginationState: this.index })));
    },
  };
}
function fillState(state) {
  while (!state.exhausted && !state.buffer.length) state.loadBatch();
}
function kWayMergePage(states, limit, offset, sortKey) {
  for (const state of states) fillState(state);
  let skipped = 0;
  const items = [];
  let scanned = 0;
  while (items.length < limit) {
    let best = null;
    let bestRow = null;
    let bestValue = -Infinity;
    for (const state of states) {
      fillState(state);
      const head = state.buffer[0];
      if (!head) continue;
      const value = Number(head[sortKey] || 0);
      if (!best || value > bestValue || (value === bestValue && comparePaginationRows(head, bestRow) < 0)) {
        best = state;
        bestRow = head;
        bestValue = value;
      }
    }
    if (!best) break;
    const next = best.buffer.shift();
    scanned += 1;
    if (skipped < offset) skipped += 1;
    else items.push(next);
    fillState(best);
  }
  return { items, scanned };
}
function comparePaginationRows(a = {}, b = {}) {
  const sourceA = String(a.source || '');
  const sourceB = String(b.source || '');
  if (sourceA !== sourceB) return sourceA.localeCompare(sourceB);
  return String(b.id || '').localeCompare(String(a.id || ''));
}
function keyForSourceRow(row) {
  return `${row?.source || ''}:${row?.id || ''}`;
}
function hydrateRequestPageItems(rawItems, states, queryAll) {
  const started = Date.now();
  const out = [];
  const byState = new Map();
  for (const row of rawItems) {
    const index = Number(row.__paginationState || 0);
    const list = byState.get(index) || [];
    list.push(row);
    byState.set(index, list);
  }
  const rowMap = new Map();
  for (const [index, messages] of byState) {
    const state = states[index];
    if (!state || !messages.length) continue;
    const { source, db, tables } = state.ctx;
    const sessions = querySessionsByIds(queryAll, db, source, messages.map((m) => m.session_id));
    const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
    for (const item of requestRowsFromMessages(messages, sessions, parts)) rowMap.set(keyForSourceRow(item), item);
  }
  for (const row of rawItems) {
    const item = rowMap.get(keyForSourceRow(row));
    if (item) out.push(item);
  }
  return { items: out, hydrated: rawItems.length, hydrationMs: Date.now() - started, hydrateGroups: byState.size };
}
function hydrateSessionPageItems(rawItems, states, queryAll) {
  const started = Date.now();
  const out = [];
  const byState = new Map();
  for (const row of rawItems) {
    const index = Number(row.__paginationState || 0);
    const list = byState.get(index) || [];
    list.push(row);
    byState.set(index, list);
  }
  const rowMap = new Map();
  const timestamp = Date.now();
  for (const [index, sessions] of byState) {
    const state = states[index];
    if (!state || !sessions.length) continue;
    const { source, db, tables } = state.ctx;
    const messages = queryMessagesForSessions(queryAll, db, source, sessions.map((s) => s.id), state.payload);
    const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
    for (const item of sessionsFromRows(sessions, messages, parts, timestamp)) rowMap.set(keyForSourceRow(item), item);
  }
  for (const row of rawItems) {
    const item = rowMap.get(keyForSourceRow(row));
    if (item) out.push(item);
  }
  return { items: out, hydrated: rawItems.length, hydrationMs: Date.now() - started, hydrateGroups: byState.size };
}
function directRequestsPage(ctx, payload, queryAll, limit, offset) {
  const { source, db, tables } = ctx;
  const base = assistantWhere(payload, { hasPart: tables.includes('part'), excludePlaceholders: true, outerAlias: 'message' });
  const total = Number(queryAll(db, `select count(*) as count from message where ${base.where}`, base.params)[0]?.count || 0);
  const cursor = decodeCursor(payload.cursor);
  const { where, params } = cursorWhere(base.where, base.params, source, cursor, 'time_created');
  const rawMessages = queryAll(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc, id desc limit ? offset ?`, [...params, cursor ? limit + 1 : limit, cursor ? 0 : offset]);
  const messages = tagRows(rawMessages, source);
  const sessions = querySessionsByIds(queryAll, db, source, messages.map((m) => m.session_id));
  const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
  const items = requestRowsFromMessages(messages, sessions, parts);
  return { total, items: cursor ? items.slice(0, limit) : items, cursorHasMore: cursor ? items.length > limit : null };
}
function directSessionsPage(ctx, payload, queryAll, limit, offset) {
  const { source, db, tables, sessionColumns } = ctx;
  const base = sessionWhere(payload, { sessionColumns });
  const total = Number(queryAll(db, `select count(*) as count from session where ${base.where}`, base.params)[0]?.count || 0);
  const cursor = decodeCursor(payload.cursor);
  const { where, params } = cursorWhere(base.where, base.params, source, cursor, 'time_updated');
  const rawSessions = queryAll(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc, id desc limit ? offset ?`, [...params, cursor ? limit + 1 : limit, cursor ? 0 : offset]);
  const sessions = tagRows(rawSessions, source);
  const messages = queryMessagesForSessions(queryAll, db, source, sessions.map((s) => s.id), payload);
  const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
  const items = sessionsFromRows(sessions, messages, parts, Date.now());
  return { total, items: cursor ? items.slice(0, limit) : items, cursorHasMore: cursor ? items.length > limit : null };
}
function pageFromContexts(contexts, payload, queryAll, defaultLimit, directPage, makeState, sortKey, hydratePageItems) {
  const { limit, offset } = pageBounds(payload, defaultLimit);
  const cursor = decodeCursor(payload.cursor);
  if (contexts.length <= 1) {
    const page = contexts[0] ? directPage(contexts[0], payload, queryAll, limit, offset) : { total: 0, items: [] };
    const last = page.items.at(-1);
    return pageResult(page.items, page.total, payload, defaultLimit, {
      strategy: cursor ? 'single-source-keyset' : 'single-source',
      hasMore: cursor ? Boolean(page.cursorHasMore) : offset + page.items.length < page.total,
      nextCursor: last ? encodeCursor(last, sortKey === 'time_created' ? 'time' : 'updatedAt') : null,
    });
  }
  const batchSize = paginationBatchSize(limit);
  const states = contexts.map((ctx, index) => {
    const state = makeState(ctx, payload, queryAll, batchSize);
    state.index = index;
    state.ctx = ctx;
    return state;
  });
  const total = states.reduce((sum, state) => sum + state.total, 0);
  const { items: mergedItems, scanned } = kWayMergePage(states, cursor ? limit + 1 : limit, cursor ? 0 : offset, sortKey);
  const hasMore = cursor ? mergedItems.length > limit : offset + mergedItems.length < total;
  const rawItems = cursor ? mergedItems.slice(0, limit) : mergedItems;
  const hydrated = hydratePageItems(rawItems, states, queryAll);
  const fetched = states.reduce((sum, state) => sum + state.fetched, 0);
  const last = hydrated.items.at(-1);
  return pageResult(hydrated.items, total, payload, defaultLimit, { strategy: cursor ? 'k-way-keyset' : 'k-way-merge', hasMore, nextCursor: last ? encodeCursor(last, sortKey === 'time_created' ? 'time' : 'updatedAt') : null, batchSize, scanned, fetched, hydrated: hydrated.hydrated, hydrateGroups: hydrated.hydrateGroups, hydrationMs: hydrated.hydrationMs });
}
function getRequestsPageNative(payload = {}) {
  const contexts = sourceContexts(payload, openNativeDbReadonly, (db) => nativeAll(db, "select name from sqlite_master where type='table'"), nativeAllParams);
  try { return pageFromContexts(contexts, payload, nativeAllParams, 100, directRequestsPage, makeRequestState, 'time_created', hydrateRequestPageItems); }
  finally { closeContexts(contexts); }
}
async function getRequestsPageSqlJs(payload = {}) {
  const contexts = await sourceContextsAsync(payload, openSqlJsDbReadonly, (db) => sqlJsAll(db, "select name from sqlite_master where type='table'"), sqlJsAllParams);
  try { return pageFromContexts(contexts, payload, sqlJsAllParams, 100, directRequestsPage, makeRequestState, 'time_created', hydrateRequestPageItems); }
  finally { closeContexts(contexts); }
}
async function getRequestsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try {
      if (ONE_SHOT_RUNTIME) return getRequestsPageNative(payload);
      return await runNativePageWorker('requestsPage', payload);
    }
    catch (error) {
      const page = await getRequestsPageSqlJs(payload);
      page.nativeError = safeDbError(error);
      return page;
    }
  }
  const page = await getRequestsPageSqlJs(payload);
  page.nativeError = 'forced';
  return page;
}
function sessionRequestsPayload(payload = {}) {
  const sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) throw new Error('缺少会话 ID');
  return { ...payload, sessionId, query: '', limit: payload.limit || 50, offset: payload.offset || 0 };
}
function getSessionRequestsPageNative(payload = {}) { return getRequestsPageNative(sessionRequestsPayload(payload)); }
async function getSessionRequestsPageSqlJs(payload = {}) { return getRequestsPageSqlJs(sessionRequestsPayload(payload)); }
async function getSessionRequestsPage(payload = {}) {
  const normalized = sessionRequestsPayload(payload);
  if (process.env.CODEARTS_BAR_FORCE_SQLJS === '1' || ONE_SHOT_RUNTIME) return getRequestsPage(normalized);
  try {
    return await runNativePageWorker('sessionRequestsPage', normalized);
  } catch (error) {
    const page = await getRequestsPageSqlJs(normalized);
    page.nativeError = safeDbError(error);
    return page;
  }
}
function getSessionsPageNative(payload = {}) {
  const contexts = sourceContexts(payload, openNativeDbReadonly, (db) => nativeAll(db, "select name from sqlite_master where type='table'"), nativeAllParams);
  try { return pageFromContexts(contexts, payload, nativeAllParams, 80, directSessionsPage, makeSessionState, 'time_updated', hydrateSessionPageItems); }
  finally { closeContexts(contexts); }
}
async function getSessionsPageSqlJs(payload = {}) {
  const contexts = await sourceContextsAsync(payload, openSqlJsDbReadonly, (db) => sqlJsAll(db, "select name from sqlite_master where type='table'"), sqlJsAllParams);
  try { return pageFromContexts(contexts, payload, sqlJsAllParams, 80, directSessionsPage, makeSessionState, 'time_updated', hydrateSessionPageItems); }
  finally { closeContexts(contexts); }
}
async function getSessionsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try {
      if (ONE_SHOT_RUNTIME) return getSessionsPageNative(payload);
      return await runNativePageWorker('sessionsPage', payload);
    }
    catch (error) {
      const page = await getSessionsPageSqlJs(payload);
      page.nativeError = safeDbError(error);
      return page;
    }
  }
  const page = await getSessionsPageSqlJs(payload);
  page.nativeError = 'forced';
  return page;
}

module.exports = { decodeCursor, encodeCursor, getRequestsPageNative, getRequestsPageSqlJs, getRequestsPage, getSessionRequestsPageNative, getSessionRequestsPageSqlJs, getSessionRequestsPage, getSessionsPageNative, getSessionsPageSqlJs, getSessionsPage };
