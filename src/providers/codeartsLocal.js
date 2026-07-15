'use strict';

const sources = require('./codearts/sources');
const collect = require('./codearts/collect');
const pagination = require('./codearts/pagination');
const logs = require('./codearts/logs');
const sessionActions = require('./codearts/session-actions');
const aggregation = require('./codearts/aggregation');
const diagnostics = require('./codearts/diagnostics');
const sessionExport = require('./codearts/session-export');

module.exports = {
  ...sources,
  ...collect,
  ...pagination,
  ...logs,
  ...sessionActions,
  ...aggregation,
  ...diagnostics,
  ...sessionExport,
};
