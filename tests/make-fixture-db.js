const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
(async () => {
  const SQL = await initSqlJs({ locateFile: f => require.resolve(`sql.js/dist/${f}`) });
  const db = new SQL.Database();
  db.run('create table session (id text primary key, title text, directory text, version text, time_created integer, time_updated integer, time_archived integer)');
  db.run('create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)');
  db.run('create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)');
  const base = Date.UTC(2026, 6, 7, 1, 0, 0);
  db.run('insert into session values (?,?,?,?,?,?,?)', ['ses_fixture', 'Fixture Session', 'C:/fixture', '1.0', base - 1000, base + 9000, null]);
  const msg = { role:'assistant', modelID:'fixture-model', providerID:'fixture-provider', time:{ created:base, completed:base+4000 }, tokens:{ input:100, output:50, reasoning:10, cache:{ read:5, write:2 }, total:167 } };
  db.run('insert into message values (?,?,?,?,?)', ['msg_fixture', 'ses_fixture', base, base+4000, JSON.stringify(msg)]);
  db.run('insert into part values (?,?,?,?,?,?)', ['part_fixture', 'msg_fixture', 'ses_fixture', base+500, base+500, JSON.stringify({ type:'tool', tool:'read' })]);
  db.run('insert into part values (?,?,?,?,?,?)', ['finish_fixture', 'msg_fixture', 'ses_fixture', base+4000, base+4000, JSON.stringify({ type:'step-finish', tokens:{ input:100, output:50, reasoning:10, cache:{ read:5, write:2 }, total:167 }, cost:0 })]);

  db.run('insert into session values (?,?,?,?,?,?,?)', ['ses_multi', 'Multi Turn Session', 'C:/fixture', '1.0', base + 10000, base + 30000, null]);
  db.run('insert into message values (?,?,?,?,?)', ['user_multi_1', 'ses_multi', base+11000, base+11000, JSON.stringify({ role:'user', summary:true })]);
  db.run('insert into message values (?,?,?,?,?)', ['assistant_multi_1', 'ses_multi', base+12000, base+15000, JSON.stringify({ role:'assistant', modelID:'multi-model', providerID:'fixture-provider', time:{ created:base+12000, completed:base+15000 }, tokens:{ input:0, output:0, reasoning:0, cache:{ read:0, write:0 } } })]);
  db.run('insert into part values (?,?,?,?,?,?)', ['finish_multi_1', 'assistant_multi_1', 'ses_multi', base+15000, base+15000, JSON.stringify({ type:'step-finish', tokens:{ input:10, output:5, reasoning:1, cache:{ read:2, write:0 }, total:18 }, cost:0 })]);
  db.run('insert into message values (?,?,?,?,?)', ['user_multi_2', 'ses_multi', base+21000, base+21000, JSON.stringify({ role:'user', summary:true })]);
  db.run('insert into message values (?,?,?,?,?)', ['assistant_multi_2', 'ses_multi', base+22000, base+26000, JSON.stringify({ role:'assistant', modelID:'multi-model', providerID:'fixture-provider', time:{ created:base+22000, completed:base+26000 }, tokens:{ input:0, output:0, reasoning:0, cache:{ read:0, write:0 } } })]);
  db.run('insert into part values (?,?,?,?,?,?)', ['finish_multi_2', 'assistant_multi_2', 'ses_multi', base+26000, base+26000, JSON.stringify({ type:'step-finish', tokens:{ input:20, output:7, reasoning:3, cache:{ read:4, write:1 }, total:35 }, cost:0 })]);
  const bytes = db.export();
  fs.writeFileSync(path.join('tests','fixtures','opencode-fixture.db'), Buffer.from(bytes));
  db.close();
})();
