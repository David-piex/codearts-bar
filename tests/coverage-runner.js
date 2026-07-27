'use strict';

const unitTests = require('./run-tests');
const sessionExport = require('./session-export-smoke');
const queryService = require('./query-service-smoke');

async function main() {
  await unitTests.main();
  await sessionExport.main();
  await queryService.main();
}

main().catch((error) => { console.error(error); process.exit(1); });
