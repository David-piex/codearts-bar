'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'UNKNOWN']);
function sleepSync(milliseconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }
function renameWithRetry(source, target, options = {}) {
  const attempts = Math.max(1, Number(options.renameAttempts || 8));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { fs.renameSync(source, target); return; }
    catch (error) {
      if (!RETRYABLE_RENAME_CODES.has(error?.code) || attempt + 1 >= attempts) throw error;
      sleepSync(Math.min(150, 20 * (attempt + 1)));
    }
  }
}

function writeFileAtomic(file, content, options = {}) {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const suffix = options.suffix || `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const temp = path.join(dir, `.${path.basename(target)}.${suffix}.tmp`);
  let handle = null;
  try {
    handle = fs.openSync(temp, 'wx', options.mode);
    fs.writeFileSync(handle, content, options.encoding || 'utf8');
    if (options.fsync !== false) fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    renameWithRetry(temp, target, options);
    return target;
  } catch (error) {
    if (handle !== null) { try { fs.closeSync(handle); } catch {} }
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
}

function writeJsonAtomic(file, value, options = {}) {
  const spacing = options.compact ? 0 : (options.spacing ?? 2);
  const newline = options.newline === false ? '' : '\n';
  return writeFileAtomic(file, JSON.stringify(value, null, spacing) + newline, options);
}

function readJsonSafe(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

module.exports = { writeFileAtomic, writeJsonAtomic, readJsonSafe, renameWithRetry };
