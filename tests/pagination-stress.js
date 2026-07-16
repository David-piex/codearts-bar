"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-bar-page-"));
process.env.USERPROFILE = tmpHome;
process.env.HOME = tmpHome;
process.env.APPDATA = path.join(tmpHome, "AppData", "Roaming");
delete process.env.CODEARTS_BAR_DB;

let sqlite;
try { sqlite = require("node:sqlite"); }
catch (error) {
  console.log(`skip - pagination stress requires node:sqlite fixture creation: ${error.message}`);
  process.exit(0);
}

const { DatabaseSync } = sqlite;
const baseTime = Date.UTC(2026, 6, 9, 12, 0, 0);
const perSource = 300;

function dbPathFor(source) {
  return path.join(tmpHome, ".codeartsdoer", source === "desktop" ? "codearts-data" : "cli-data", "opencode.db");
}

function assistantData(source, i, created) {
  return JSON.stringify({
    role: "assistant",
    providerID: "codearts",
    modelID: i % 2 ? "GLM-5.1" : "deepseek-v4-flash",
    time: { created, completed: created + 700 + (i % 10) * 20 },
    tokens: {
      input: 100 + i,
      output: 40 + (i % 20),
      cache: { read: 200 + (i % 30), write: 10 + (i % 5) },
    },
  });
}

function createDb(source) {
  const dbPath = dbPathFor(source);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const sourceOffset = source === "desktop" ? 0 : 1;
  try {
    db.exec(`
      create table session (
        id text primary key,
        parent_id text,
        title text,
        directory text,
        version text,
        time_created integer,
        time_updated integer,
        time_archived integer
      );
      create table message (
        id text primary key,
        session_id text,
        time_created integer,
        time_updated integer,
        data text
      );
      create index idx_message_time on message(time_created);
      create index idx_session_time on session(time_updated);
    `);
    const insertSession = db.prepare("insert into session(id,parent_id,title,directory,version,time_created,time_updated,time_archived) values(?,?,?,?,?,?,?,?)");
    const insertMessage = db.prepare("insert into message(id,session_id,time_created,time_updated,data) values(?,?,?,?,?)");
    db.exec("begin");
    for (let i = 0; i < perSource; i += 1) {
      const sessionTime = baseTime - (i * 2 + sourceOffset) * 2000;
      const messageTime = baseTime - (i * 2 + sourceOffset) * 1000;
      const sessionId = `s-${i}`;
      insertSession.run(sessionId, '', `${source} 会话 ${i}`, `C:/stress/${source}/${i % 12}`, "1", sessionTime - 60000, sessionTime, i % 29 === 0 ? sessionTime + 1000 : null);
      insertMessage.run(`m-${i}`, sessionId, messageTime, messageTime + 1000, assistantData(source, i, messageTime));
    }
    insertSession.run(`internal-${source}`, 's-0', `Internal ${source} (@explore subagent)`, `C:/stress/${source}`, '1', baseTime, baseTime + 1000, null);
    db.exec("commit");
  } catch (error) {
    try { db.exec("rollback"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function expectedKeys(kind, offset, limit) {
  const rows = [];
  for (const source of ["desktop", "cli"]) {
    const sourceOffset = source === "desktop" ? 0 : 1;
    for (let i = 0; i < perSource; i += 1) {
      const time = baseTime - (i * 2 + sourceOffset) * (kind === "sessions" ? 2000 : 1000);
      rows.push({ key: `${source}:${kind === "sessions" ? "s" : "m"}-${i}`, time });
    }
  }
  return rows.sort((a, b) => b.time - a.time).slice(offset, offset + limit).map((x) => x.key);
}

async function assertPage(runtime, kind, page) {
  const offset = 220;
  const limit = 20;
  assert.equal(page.ok, true, `${runtime} ${kind} page should be ok`);
  assert.equal(page.strategy, "k-way-merge", `${runtime} ${kind} should use k-way merge`);
  assert.equal(page.total, perSource * 2, `${runtime} ${kind} total should include both sources`);
  assert.equal(page.items.length, limit, `${runtime} ${kind} should return requested page size`);
  assert.ok(page.fetched < (offset + limit) * 2, `${runtime} ${kind} should fetch fewer rows than offset+limit per source`);
  assert.equal(page.hydrated, limit, `${runtime} ${kind} should hydrate only the current page rows`);
  assert.ok(page.hydrated < page.scanned, `${runtime} ${kind} should not hydrate skipped offset rows`);
  assert.ok(page.hydrateGroups <= 2, `${runtime} ${kind} should group hydration by data source`);
  assert.deepEqual(page.items.map((x) => `${x.source}:${x.id}`), expectedKeys(kind, offset, limit));
  if (kind === 'sessions') assert.ok(page.items.every((item) => !item.id.startsWith('internal-')));
}

async function main() {
  createDb("desktop");
  createDb("cli");
  const pagination = require("../src/providers/codearts/pagination");
  const payload = { source: "all", limit: 20, offset: 220 };
  await assertPage("native", "requests", pagination.getRequestsPageNative(payload));
  await assertPage("native", "sessions", pagination.getSessionsPageNative(payload));
  await assertPage("sql.js", "requests", await pagination.getRequestsPageSqlJs(payload));
  await assertPage("sql.js", "sessions", await pagination.getSessionsPageSqlJs(payload));
  const cliOnly = pagination.getRequestsPageNative({ source: "cli", limit: 20, offset: 40 });
  assert.equal(cliOnly.strategy, "single-source");
  assert.equal(cliOnly.total, perSource);
  console.log(`ok - pagination k-way stress requests/sessions sources=2 offset=${payload.offset} limit=${payload.limit}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});
