'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'real');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
const BASE = Date.UTC(2026, 6, 7, 1, 0, 0);

function schema(db) {
  db.run('create table session (id text primary key, title text, directory text, version text, time_created integer, time_updated integer, time_archived integer)');
  db.run('create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)');
  db.run('create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)');
}

function insertSession(db, id, version, offset = 0) {
  db.run('insert into session values (?,?,?,?,?,?,?)', [id, `Sanitized ${id}`, `C:/sanitized/${id}`, version, BASE + offset, BASE + offset + 60000, null]);
}

function insertMessage(db, id, sessionId, offset, data) {
  db.run('insert into message values (?,?,?,?,?)', [id, sessionId, BASE + offset, BASE + offset + 1000, JSON.stringify(data)]);
}

function insertPart(db, id, messageId, sessionId, offset, data) {
  db.run('insert into part values (?,?,?,?,?,?)', [id, messageId, sessionId, BASE + offset, BASE + offset, JSON.stringify(data)]);
}

function desktop1317(db) {
  const session = 'desktop-session';
  insertSession(db, session, '1.3.17');
  insertMessage(db, 'desktop-finished', session, 1000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'desktop-model',
    time: { created: BASE + 1000, completed: BASE + 2000 },
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 }, total: 165 },
  });
  insertPart(db, 'desktop-finish-part', 'desktop-finished', session, 2000, {
    type: 'step-finish', tokens: { input: 90, output: 20, reasoning: 5, cache: { read: 25, write: 10 }, total: 150 },
  });
  insertMessage(db, 'desktop-placeholder', session, 3000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'desktop-model',
    time: { created: BASE + 3000 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
  });
  insertMessage(db, 'desktop-error', session, 4000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'desktop-model',
    time: { created: BASE + 4000 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
    error: { name: 'SanitizedError', message: 'sanitized failure' },
  });
  insertMessage(db, 'desktop-completed-zero', session, 5000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'desktop-model',
    time: { created: BASE + 5000, completed: BASE + 6000 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
  });
  insertMessage(db, 'desktop-user', session, 7000, { role: 'user' });
  insertPart(db, 'desktop-text', 'desktop-finished', session, 1500, { type: 'text', text: 'sanitized' });
  insertPart(db, 'desktop-tool', 'desktop-finished', session, 1600, { type: 'tool', tool: 'read', state: { status: 'completed' } });
  insertPart(db, 'desktop-reasoning', 'desktop-finished', session, 1700, { type: 'reasoning' });
}

function cli2654(db) {
  const session = 'cli-2654-session';
  insertSession(db, session, '26.5.4');
  insertMessage(db, 'cli-2654-message', session, 1000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'cli-model-a',
    time: { created: BASE + 1000, completed: BASE + 2000 },
    tokens: { input: 50, output: 15, reasoning: 3, cache: { read: 25, write: 7 }, total: 100 },
  });
  insertMessage(db, 'cli-2654-step', session, 3000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'cli-model-b', time: { created: BASE + 3000 },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
  });
  insertPart(db, 'cli-2654-finish', 'cli-2654-step', session, 4000, {
    type: 'step-finish', tokens: { input: 25, output: 8, reasoning: 2, cache: { read: 12, write: 3 }, total: 50 },
  });
  insertMessage(db, 'cli-2654-interrupted', session, 5000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'cli-model-b',
    time: { created: BASE + 5000 }, tokens: { input: 7, output: 2, reasoning: 1, cache: { read: 2, write: 0 }, total: 10 },
    error: { name: 'InterruptedError', message: 'sanitized interruption' },
  });
  insertMessage(db, 'cli-2654-placeholder', session, 6000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'cli-model-b',
    time: { created: BASE + 6000 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
  });
  insertPart(db, 'cli-2654-tool', 'cli-2654-message', session, 1500, { type: 'tool', tool: 'edit', state: { status: 'completed' } });
}

function cli2656(db) {
  const session = 'cli-2656-session';
  insertSession(db, session, '26.5.6');
  insertMessage(db, 'cli-2656-alias', session, 1000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'cli-model-compat',
    time: { created: BASE + 1000, completed: BASE + 2000 },
    usage: { input_tokens: 40, output_tokens: 10, reasoning_tokens: 2, cached_tokens: 8, cache_creation_input_tokens: 5, total_tokens: 65 },
  });
  insertMessage(db, 'cli-2656-step', session, 3000, {
    role: 'assistant', providerID: 'sanitized-provider', modelID: 'cli-model-compat', time: { created: BASE + 3000 },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 },
  });
  insertPart(db, 'cli-2656-finish', 'cli-2656-step', session, 4000, {
    type: 'step-finish', usage: { input_tokens: 25, output_tokens: 6, reasoning_tokens: 2, cached_tokens: 5, cache_creation_input_tokens: 2, total_tokens: 40 },
  });
}

const builders = { 'desktop-1.3.17': desktop1317, 'cli-26.5.4': cli2654, 'cli-26.5.6': cli2656 };

async function generateFixtureBytes(fixture) {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const db = new SQL.Database();
  schema(db);
  assert.equal(typeof builders[fixture.id], 'function', `missing fixture builder ${fixture.id}`);
  builders[fixture.id](db);
  const bytes = Buffer.from(db.export());
  db.close();
  return bytes;
}

async function generateFixtures(outputDir = fixtureRoot) {
  fs.mkdirSync(outputDir, { recursive: true });
  const files = [];
  for (const fixture of manifest.fixtures) {
    const file = path.join(outputDir, fixture.file);
    fs.writeFileSync(file, await generateFixtureBytes(fixture));
    files.push(file);
  }
  return files;
}

async function checkFixtures() {
  for (const fixture of manifest.fixtures) {
    const file = path.join(fixtureRoot, fixture.file);
    assert.equal(fs.existsSync(file), true, `missing generated fixture ${fixture.file}`);
    assert.deepEqual(fs.readFileSync(file), await generateFixtureBytes(fixture), `${fixture.file} does not match its deterministic builder`);
  }
}

if (require.main === module) {
  (process.argv.includes('--check') ? checkFixtures() : generateFixtures())
    .then(() => console.log(`ok - sanitized real-shape fixtures ${process.argv.includes('--check') ? 'match' : 'generated'} manifest=${path.relative(root, path.join(fixtureRoot, 'manifest.json'))}`))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { manifest, fixtureRoot, generateFixtureBytes, generateFixtures, checkFixtures };
