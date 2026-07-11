'use strict';
const { queryPayload } = require('./protocol/query');
function jetbrainsPayload(snapshot = {}) { return queryPayload(snapshot, 'dashboard'); }
module.exports = { jetbrainsPayload };
