'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function createLogger({ app, shell }) {
  function safeUserDataPath() {
    try { return app.getPath('userData'); } catch { return os.tmpdir(); }
  }
  function logPath() {
    return path.join(safeUserDataPath(), 'codearts-bar.log');
  }
  function appendLog(level, scope, message, detail = null) {
    try {
      fs.mkdirSync(path.dirname(logPath()), { recursive: true });
      const line = JSON.stringify({
        time: new Date().toISOString(),
        level,
        scope,
        message: String(message || ''),
        detail,
      });
      fs.appendFileSync(logPath(), `${line}\n`, 'utf8');
    } catch {}
  }
  function openLogFile() {
    try {
      fs.mkdirSync(path.dirname(logPath()), { recursive: true });
      if (!fs.existsSync(logPath())) fs.writeFileSync(logPath(), '', 'utf8');
    } catch {}
    return shell.openPath(logPath());
  }
  return { safeUserDataPath, logPath, appendLog, openLogFile };
}

module.exports = { createLogger };
