'use strict';

const { fetchOfficialStats, fetchOfficialStatsAsync, fetchOfficialStatsCached, officialStatsCacheStatus } = require('../officialStats');
module.exports = {
  id: 'codearts-official',
  name: 'CodeArts Official Stats',
  fetchOfficialStats,
  fetchOfficialStatsAsync,
  fetchOfficialStatsCached,
  officialStatsCacheStatus,
};
