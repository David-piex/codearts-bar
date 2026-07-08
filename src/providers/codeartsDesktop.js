'use strict';

const { getAuthStatus, authStatusToText } = require('../authStatus');
module.exports = { id: 'codearts-desktop', name: 'CodeArts Desktop/Auth', getAuthStatus, authStatusToText };
