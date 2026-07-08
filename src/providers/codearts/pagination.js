'use strict';

const { listDataSources, validateTables, sourceMatchesPayload, pageBounds, assistantWhere, sessionWhere, tagRows } = require('./sources');
const { openNativeDbReadonly, openSqlJsDbReadonly, nativeAll, nativeAllParams, sqlJsAll, sqlJsAllParams, closeDb } = require('./sqlite');
const { requestRowsFromMessages, sessionsFromRows, queryPartsForMessages, querySessionsByIds, queryMessagesForSessions } = require('./collect');

function pageResult(items, total, payload, defaultLimit) {
  const { limit, offset } = pageBounds(payload, defaultLimit);
  return { ok: true, limit, offset, total, hasMore: offset + items.length < total, items };
}
function getRequestsPageNative(payload = {}) {
  const { limit, offset } = pageBounds(payload, 100);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = openNativeDbReadonly(source.dbPath);
      const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = assistantWhere(payload);
      const count = nativeAllParams(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawMessages = nativeAllParams(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc limit ? offset ?`, [...params, offset + limit, 0]);
      const messages = tagRows(rawMessages, source);
      const sessions = querySessionsByIds(nativeAllParams, db, source, messages.map((m) => m.session_id));
      const parts = tables.includes('part') ? queryPartsForMessages(nativeAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...requestRowsFromMessages(messages, sessions, parts));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 100);
}
async function getRequestsPageSqlJs(payload = {}) {
  const { limit, offset } = pageBounds(payload, 100);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    const db = await openSqlJsDbReadonly(source.dbPath);
    try {
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = assistantWhere(payload);
      const count = sqlJsAllParams(db, `select count(*) as count from message where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawMessages = sqlJsAllParams(db, `select id, session_id, time_created, time_updated, data from message where ${where} order by time_created desc limit ? offset ?`, [...params, offset + limit, 0]);
      const messages = tagRows(rawMessages, source);
      const sessions = querySessionsByIds(sqlJsAllParams, db, source, messages.map((m) => m.session_id));
      const parts = tables.includes('part') ? queryPartsForMessages(sqlJsAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...requestRowsFromMessages(messages, sessions, parts));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 100);
}
async function getRequestsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getRequestsPageNative(payload); }
    catch (error) {
      const page = await getRequestsPageSqlJs(payload);
      page.nativeError = error.message;
      return page;
    }
  }
  const page = await getRequestsPageSqlJs(payload);
  page.nativeError = 'CODEARTS_BAR_FORCE_SQLJS=1';
  return page;
}
function getSessionsPageNative(payload = {}) {
  const { limit, offset } = pageBounds(payload, 80);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    let db;
    try {
      db = openNativeDbReadonly(source.dbPath);
      const tables = nativeAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = sessionWhere(payload);
      const count = nativeAllParams(db, `select count(*) as count from session where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawSessions = nativeAllParams(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc limit ? offset ?`, [...params, offset + limit, 0]);
      const sessions = tagRows(rawSessions, source);
      const messages = queryMessagesForSessions(nativeAllParams, db, source, sessions.map((s) => s.id));
      const parts = tables.includes('part') ? queryPartsForMessages(nativeAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...sessionsFromRows(sessions, messages, parts, Date.now()));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 80);
}
async function getSessionsPageSqlJs(payload = {}) {
  const { limit, offset } = pageBounds(payload, 80);
  const rowsBySource = [];
  let total = 0;
  for (const source of listDataSources(payload).filter((s) => sourceMatchesPayload(s, payload))) {
    const db = await openSqlJsDbReadonly(source.dbPath);
    try {
      const tables = sqlJsAll(db, "select name from sqlite_master where type='table'").map((r) => r.name);
      validateTables(tables);
      const { where, params } = sessionWhere(payload);
      const count = sqlJsAllParams(db, `select count(*) as count from session where ${where}`, params)[0]?.count || 0;
      total += Number(count || 0);
      const rawSessions = sqlJsAllParams(db, `select id, title, directory, version, time_created, time_updated, time_archived from session where ${where} order by time_updated desc limit ? offset ?`, [...params, offset + limit, 0]);
      const sessions = tagRows(rawSessions, source);
      const messages = queryMessagesForSessions(sqlJsAllParams, db, source, sessions.map((s) => s.id));
      const parts = tables.includes('part') ? queryPartsForMessages(sqlJsAllParams, db, source, messages.map((m) => m.id)) : [];
      rowsBySource.push(...sessionsFromRows(sessions, messages, parts, Date.now()));
    } finally { closeDb(db); }
  }
  const items = rowsBySource.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(offset, offset + limit);
  return pageResult(items, total, payload, 80);
}
async function getSessionsPage(payload = {}) {
  if (process.env.CODEARTS_BAR_FORCE_SQLJS !== '1') {
    try { return getSessionsPageNative(payload); }
    catch (error) {
      const page = await getSessionsPageSqlJs(payload);
      page.nativeError = error.message;
      return page;
    }
  }
  const page = await getSessionsPageSqlJs(payload);
  page.nativeError = 'CODEARTS_BAR_FORCE_SQLJS=1';
  return page;
}

module.exports = { getRequestsPageNative, getRequestsPageSqlJs, getRequestsPage, getSessionsPageNative, getSessionsPageSqlJs, getSessionsPage };
