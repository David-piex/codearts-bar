'use strict';

class Provider {
  constructor(meta) { this.meta = meta; }
  async snapshot() { throw new Error('Provider.snapshot() not implemented'); }
}
const codeartsLocalProvider = {
  id: 'codearts-local',
  name: 'CodeArts Local',
  source: 'opencode.db + logs + codearts_cli.json',
  capabilities: ['usage', 'models', 'tools', 'performance', 'ttft', 'trends', 'sessions', 'errors'],
};
const codeartsOfficialProvider = {
  id: 'codearts-official',
  name: 'CodeArts Official Stats',
  source: 'codearts stats',
  capabilities: ['official-usage', 'cost', 'models'],
  auth: ['CODEARTS_CLI_AK', 'CODEARTS_CLI_SK'],
};
const codeartsDesktopProvider = {
  id: 'codearts-desktop',
  name: 'CodeArts Desktop',
  source: 'desktop storage + process scan',
  capabilities: ['auth-status', 'process-status'],
};
function listProviders() { return [codeartsLocalProvider, codeartsOfficialProvider, codeartsDesktopProvider]; }
module.exports = { Provider, listProviders, codeartsLocalProvider, codeartsOfficialProvider, codeartsDesktopProvider };
