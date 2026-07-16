'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'media', 'scripts', 'dashboard.js'), 'utf8');
const posted = [];
const savedStates = [];
const listeners = {};
const elements = new Map();
const viewCalls = { sessionRows: [], requestRows: [], requestDetail: [] };
const saved = {
  range: 'all',
  sourceFilter: 'all',
  modelFilter: 'all',
  projectFilter: 'all',
  sessionPage: 3,
  requestPage: 2,
  selectedRequestId: 'request-page-2',
  selectedRequestSource: 'cli',
  sessionSearch: 'retained search',
  scrollTop: 417,
};

function element(selector) {
  if (!elements.has(selector)) {
    elements.set(selector, {
      value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, focus() {}, select() {}, closest() { return null; }, querySelector() { return null; },
    });
  }
  return elements.get(selector);
}

const document = {
  activeElement: null,
  scrollingElement: { scrollTop: 0 },
  body: element('body'),
  querySelector: element,
  querySelectorAll() { return []; },
  addEventListener(type, handler) { listeners[`document:${type}`] = handler; },
};
const window = {
  CodeArtsFormat: { html: (value) => String(value ?? '') },
  CodeArtsViews: {
    metrics() {}, models() {}, providers() {}, sources() {}, performance() {},
    sessions(value) { viewCalls.sessionRows.push(value.sessions || []); },
    requests(value) { viewCalls.requestRows.push(value.requests || []); },
    sessionRows(items, page) { viewCalls.sessionRows.push({ items, page }); },
    requestRows(items, page) { viewCalls.requestRows.push({ items, page }); },
    requestDetail(item) { viewCalls.requestDetail.push(item); },
  },
  CodeArtsChart: { draw() {} },
  addEventListener(type, handler) { listeners[`window:${type}`] = handler; },
};
const vscode = {
  getState: () => ({ ...saved }),
  setState: (state) => savedStates.push({ ...state }),
  postMessage: (message) => posted.push(message),
};

vm.runInNewContext(source, {
  acquireVsCodeApi: () => vscode,
  window,
  document,
  requestAnimationFrame: (callback) => callback(),
  Date,
  Math,
  Number,
  String,
  Boolean,
  Intl,
  Map,
  Set,
  console,
}, { filename: 'extension/media/scripts/dashboard.js' });

assert.equal(document.scrollingElement.scrollTop, 417, 'saved scroll position must be restored');
assert.equal(element('#sessionSearch').value, 'retained search');
assert.equal(posted.find((item) => item.type === 'sessionsPage').page, 3);
assert.equal(posted.find((item) => item.type === 'sessionsPage').search, 'retained search');
assert.equal(posted.find((item) => item.type === 'requestsPage').page, 2);

const receive = listeners['window:message'];
receive({ data: { type: 'detailsError', generation: 1, payload: { error: 'initial details unavailable' } } });
assert.equal(element('#loading').hidden, true, 'initial detail failure must close the loading surface');
assert.equal(element('#dashboard').hidden, true, 'initial detail failure must not reveal an empty dashboard');
assert.equal(element('#error').hidden, false, 'initial detail failure must reveal the error surface');
assert.equal(element('#errorText').textContent, 'initial details unavailable');
receive({ data: { type: 'sessionsPage', payload: { ok: true, data: { items: [{ id: 'session-page-3' }], page: 3, pageCount: 4, total: 61 } } } });
  receive({ data: { type: 'requestsPage', payload: { ok: true, data: { items: [
    { id: 'request-page-2', source: 'desktop', model: 'wrong-model' },
    { id: 'request-page-2', source: 'cli', model: 'page-model' },
  ], page: 2, pageCount: 3, total: 81 } } } });
  assert.equal(viewCalls.requestDetail.at(-1)?.id, 'request-page-2', 'selected request must be restored from the database page');
  assert.equal(viewCalls.requestDetail.at(-1)?.model, 'page-model', 'duplicate request IDs must restore the row from the selected source');

const callsBeforeDetails = { sessions: viewCalls.sessionRows.length, requests: viewCalls.requestRows.length, detail: viewCalls.requestDetail.length };
receive({ data: { type: 'details', generation: 1, payload: {
  ok: true,
  timestamp: 1783512000000,
  updatedAt: 'now',
  usage: { today: {}, window: {}, week: {}, all: {} },
  trends: { range: [], hourly24h: [], daily14d: [] },
  models: [], providers: [], sources: [], projects: [],
  sessions: [{ id: 'snapshot-first-session' }],
  requests: [{ id: 'snapshot-first-request' }],
  performance: {}, diagnostics: {},
} } });

assert.equal(viewCalls.sessionRows.length, callsBeforeDetails.sessions, 'details refresh must not render snapshot session samples over page 3');
assert.equal(viewCalls.requestRows.length, callsBeforeDetails.requests, 'details refresh must not render snapshot request samples over page 2');
assert.equal(viewCalls.requestDetail.length, callsBeforeDetails.detail, 'details refresh must preserve the selected request detail');
const refreshedSessionRequest = posted.filter((item) => item.type === 'sessionsPage').at(-1);
const refreshedRequestRequest = posted.filter((item) => item.type === 'requestsPage').at(-1);
assert.equal(refreshedSessionRequest.page, 3);
assert.equal(refreshedSessionRequest.search, 'retained search');
assert.equal(refreshedRequestRequest.page, 2);
assert.equal(document.scrollingElement.scrollTop, 417);
assert.deepEqual(
    Object.fromEntries(['sessionPage', 'requestPage', 'selectedRequestId', 'selectedRequestSource', 'sessionSearch', 'scrollTop'].map((key) => [key, savedStates.at(-1)[key]])),
    { sessionPage: 3, requestPage: 2, selectedRequestId: 'request-page-2', selectedRequestSource: 'cli', sessionSearch: 'retained search', scrollTop: 417 },
);

receive({ data: { type: 'details', generation: 2, payload: {
  ok: true,
  timestamp: 1783512000001,
  updatedAt: 'now',
  selectedScope: { source: 'missing-source', model: 'missing-model', project: 'C:/missing' },
  filterOptionsComplete: true,
  filterSources: [{ id: 'cli', label: 'CLI' }],
  filterModels: [{ name: 'current-model' }],
  filterProjects: [{ id: 'C:/current', directory: 'C:/current', label: 'current', count: 1 }],
  usage: { today: {}, window: {}, week: {}, all: {} },
  trends: { range: [], hourly24h: [], daily14d: [] },
  models: [], providers: [], sources: [], projects: [], sessions: [], requests: [], performance: {}, diagnostics: {},
} } });
const recoveredFilter = posted.filter((item) => item.type === 'filter').at(-1);
assert.deepEqual(
  { source: recoveredFilter.source, model: recoveredFilter.model, project: recoveredFilter.project },
  { source: 'all', model: 'all', project: 'all' },
  'authoritative filter options must prune stale selections and automatically recover the current view',
);

receive({ data: { type: 'reset', generation: 3 } });
assert.equal(element('#loading').hidden, false, 'database switches must restore the loading surface');
assert.equal(element('#dashboard').hidden, true, 'database switches must hide rows from the previous database');
assert.equal(viewCalls.requestDetail.at(-1), null, 'database switches must clear request details from the previous database');
assert.equal(savedStates.at(-1).sessionPage, 1);
assert.equal(savedStates.at(-1).requestPage, 1);

console.log('ok - vscode webview preserves database pages search selection and scroll on details refresh');
