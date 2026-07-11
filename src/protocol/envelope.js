'use strict';
const PROTOCOL_VERSION = 1;
function envelope(data, meta = {}) { return { protocolVersion: PROTOCOL_VERSION, ok: true, requestId: meta.requestId || null, generatedAt: meta.generatedAt || Date.now(), data, diagnostics: meta.diagnostics || {} }; }
function failure(error, meta = {}) { return { protocolVersion: PROTOCOL_VERSION, ok: false, requestId: meta.requestId || null, generatedAt: Date.now(), error: error instanceof Error ? error.message : String(error || 'Unknown error') }; }
module.exports = { PROTOCOL_VERSION, envelope, failure };
