'use strict';

const { listDataSources, validateTables, sourceMatchesPayload, pageBounds, assistantWhere, sessionWhere, tagRows } = require('./sources');
const { safeDbError } = require('./diagnostics');
const { openNativeDbReadonly, openSqlJsDbReadonly, nativeAll, nativeAllParams, sqlJsAll, sqlJsAllParams, closeDb } = require('./sqlite');
const { requestRowsFromMessages, sessionsFromRows, queryPartsForMessages, querySessionsByIds, queryMessagesForSessions } = require('./collect');

function pageResult(items, total, payload, defaultLimit, extra = {}) {
  const { limit, offset } = pageBounds(payload, defaultLimit);
  return { ok: true, limit, offset, total, hasMore: offset + items.length < total, items, ...extra };
}
function paginationBatchSize(limit) {
  return Math.max(80, Math.min(500, Number(limit || 100) * 2));
}
function sourceContexts(payload, openDb, tableQuery) {
  const contexts = [];
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = openDb(source.dbPath);
      const tables = tableQuery(db).map((r) => r.name);
      validateTables(tables);
      contexts.push({ source, db, tables });
    } catch (error) {
      closeDb(db);
      throw new Error(safeDbError(error));
    }
  }
  return contexts;
}
async function sourceContextsAsync(payload, openDb, tableQuery) {
  const contexts = [];
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = await openDb(source.dbPath);
      const tables = tableQuery(db).map((r) => r.name);
      validateTables(tables);
      contexts.push({ source, db, tables });
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
  const { where, params } = assistantWhere(payload);
  const total = Number(queryAll(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0);
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
  const { source, db, tables } = ctx;
  const { where, params } = sessionWhere(payload);
  const total = Number(queryAll(db, `select count(*) as count from session where ${where}`, params)[0]?.count || 0);
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
    let bestValue = -Infinity;
    for (const state of states) {
      fillState(state);
      const head = state.buffer[0];
      if (!head) continue;
      const value = Number(head[sortKey] || 0);
      if (!best || value > bestValue || (value === bestValue && comparePaginationRows(head, state.buffer[0]) < 0)) { best = state; bestValue = value; }
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
  return String(a.id || '').localeCompare(String(b.id || ''));
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
  const { where, params } = assistantWhere(payload);
  const total = Number(queryAll(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0);
  const rawMessages = queryAll(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc, id desc limit ? offset ?`, [...params, limit, offset]);
  const messages = tagRows(rawMessages, source);
  const sessions = querySessionsByIds(queryAll, db, source, messages.map((m) => m.session_id));
  const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
  return { total, items: requestRowsFromMessages(messages, sessions, parts) };
}
function directSessionsPage(ctx, payload, queryAll, limit, offset) {
  const { source, db, tables } = ctx;
  const { where, params } = sessionWhere(payload);
  const total = Number(queryAll(db, `select count(*) as count from session where ${where}`, params)[0]?.count || 0);
  const rawSessions = queryAll(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc, id desc limit ? offset ?`, [...params, limit, offset]);
  const sessions = tagRows(rawSessions, source);
  const messages = queryMessagesForSessions(queryAll, db, source, sessions.map((s) => s.id), payload);
  const parts = tables.includes('part') ? queryPartsForMessages(queryAll, db, source, messages.map((m) => m.id)) : [];
  return { total, items: sessionsFromRows(sessions, messages, parts, Date.now()) };
}
function pageFromContexts(contexts, payload, queryAll, defaultLimit, directPage, makeState, sortKey, hydratePageItems) {
  const { limit, offset } = pageBounds(payload, defaultLimit);
  if (contexts.length <= 1) {
    const page = contexts[0] ? directPage(contexts[0], payload, queryAll, limit, offset) : { total: 0, items: [] };
    return pageResult(page.items, page.total, payload, defaultLimit, { strategy: 'single-source' });
  }
  const batchSize = paginationBatchSize(limit);
  const states = contexts.map((ctx, index) => {
    const state = makeState(ctx, payload, queryAll, batchSize);
    state.index = index;
    state.ctx = ctx;
    return state;
  });
  const total = states.reduce((sum, state) => sum + state.total, 0);
  const { items: rawItems, scanned } = kWayMergePage(states, limit, offset, sortKey);
  const hydrated = hydratePageItems(rawItems, states, queryAll);
  const fetched = states.reduce((sum, state) => sum + state.fetched, 0);
  return pageResult(hydrated.items, total, payload, defaultLimit, { strategy: 'k-way-merge', batchSize, scanned, fetched, hydrated: hydrated.hydrated, hydrateGroups: hydrated.hydrateGroups, hydrationMs: hydrated.hydrationMs });
}
function getRequestsPageNative(payload = {}) {
  const contexts = sourceContexts(payload, openNativeDbReadonly, (db) => nativeAll(db, "select name from sqlite_master where type='table'"));
  try { return pageFromContexts(contexts, payload, nativeAllParams, 100, directRequestsPage, makeRequestState, 'time_created', hydrateRequestPageItems); }
  finally { closeContexts(contexts); }
}
async function getRequestsPageSqlJs(payload = {}) {
  const contexts = await sourceContextsAsync(payload, openSqlJsDbReadonly, (db) => sqlJsAll(db, "select name from sqlite_master where type='table'"));
  try { return pageFromContexts(contexts, payload, sqlJsAllParams, 100, directRequestsPage, makeRequestState, 'time_created', hydrateRequestPageItems); }
  finally { closeContexts(contexts); }
}
async function getRequestsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getRequestsPageNative(payload); }
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
async function getSessionRequestsPage(payload = {}) { return getRequestsPage(sessionRequestsPayload(payload)); }
function getSessionsPageNative(payload = {}) {
  const contexts = sourceContexts(payload, openNativeDbReadonly, (db) => nativeAll(db, "select name from sqlite_master where type='table'"));
  try { return pageFromContexts(contexts, payload, nativeAllParams, 80, directSessionsPage, makeSessionState, 'time_updated', hydrateSessionPageItems); }
  finally { closeContexts(contexts); }
}
async function getSessionsPageSqlJs(payload = {}) {
  const contexts = await sourceContextsAsync(payload, openSqlJsDbReadonly, (db) => sqlJsAll(db, "select name from sqlite_master where type='table'"));
  try { return pageFromContexts(contexts, payload, sqlJsAllParams, 80, directSessionsPage, makeSessionState, 'time_updated', hydrateSessionPageItems); }
  finally { closeContexts(contexts); }
}
async function getSessionsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSessionsPageNative(payload); }
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

module.exports = { getRequestsPageNative, getRequestsPageSqlJs, getRequestsPage, getSessionRequestsPageNative, getSessionRequestsPageSqlJs, getSessionRequestsPage, getSessionsPageNative, getSessionsPageSqlJs, getSessionsPage };
