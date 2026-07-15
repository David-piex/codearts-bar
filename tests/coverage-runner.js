'use strict';

const unitTests = require('./run-tests');
const sessionExport = require('./session-export-smoke');

async function main() {
  await unitTests.main();
  await sessionExport.main();
}

main().catch((error) => { console.error(error); process.exit(1); });
