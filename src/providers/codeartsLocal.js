'use strict';

const sources = require('./codearts/sources');
const collect = require('./codearts/collect');
const pagination = require('./codearts/pagination');
const logs = require('./codearts/logs');
const sessionActions = require('./codearts/session-actions');
const aggregation = require('./codearts/aggregation');

module.exports = {
  ...sources,
  ...collect,
  ...pagination,
  ...logs,
  ...sessionActions,
  ...aggregation,
};
