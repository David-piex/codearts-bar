'use strict';

const { exportSessionToFile, exportSessionsToFile } = require('./session-export');
const { failure } = require('../../protocol/envelope');

function readOption(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function readOptions(args, name) {
  const values = [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === name) values.push(args[index + 1]);
  }
  return values;
}

function privacyOptions(args) {
  return {
    includeContent: !args.includes('--no-content'),
    includeReasoning: args.includes('--include-reasoning'),
    includeToolIO: args.includes('--include-tool-io'),
    redactPaths: !args.includes('--no-redact-paths'),
    includeErrors: !args.includes('--no-errors'),
  };
}

async function run(args = process.argv.slice(2)) {
  const command = args[0];
  const common = {
    dbPath: readOption(args, '--db'),
    format: readOption(args, '--format', 'json'),
    outputPath: readOption(args, '--output'),
    ...privacyOptions(args),
  };
  if (command === 'export-session') {
    const result = await exportSessionToFile({
      ...common,
      sessionId: readOption(args, '--session-id'),
      source: readOption(args, '--source'),
    });
    return { ok: true, path: result.path, format: result.format, bytes: result.bytes, sessions: 1 };
  }
  if (command === 'export-sessions') {
    const ids = readOptions(args, '--session-id');
    const sources = readOptions(args, '--session-source');
    const sessions = ids.map((id, index) => ({ id, source: sources[index] || '' }));
    const result = await exportSessionsToFile({ ...common, sessions });
    return { ok: true, path: result.path, format: result.format, bytes: result.bytes, sessions: result.model.sessions.length };
  }
  throw new Error('Session export CLI supports export-session or export-sessions');
}

if (require.main === module) run()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => { console.log(JSON.stringify(failure(error))); process.exitCode = 1; });

module.exports = { run, readOption, readOptions, privacyOptions };
