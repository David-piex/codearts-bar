'use strict';

const { exportSessionToFile } = require('./session-export');
const { failure } = require('../../protocol/envelope');

function readOption(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

async function run(args = process.argv.slice(2)) {
  if (args[0] !== 'export-session') throw new Error('Session export CLI supports only export-session');
  const result = await exportSessionToFile({
    sessionId: readOption(args, '--session-id'),
    source: readOption(args, '--source'),
    dbPath: readOption(args, '--db'),
    format: readOption(args, '--format', 'json'),
    outputPath: readOption(args, '--output'),
    includeContent: !args.includes('--no-content'),
    includeReasoning: args.includes('--include-reasoning'),
    includeToolIO: args.includes('--include-tool-io'),
    redactPaths: !args.includes('--no-redact-paths'),
    includeErrors: !args.includes('--no-errors'),
  });
  return { ok: true, path: result.path, format: result.format, bytes: result.bytes };
}

if (require.main === module) run()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => { console.log(JSON.stringify(failure(error))); process.exitCode = 1; });

module.exports = { run, readOption };
