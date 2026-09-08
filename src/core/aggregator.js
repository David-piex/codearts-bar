'use strict';

const cacheMetrics = require('./cacheMetrics');

function parseJsonSafe(value, fallback = null) { if (!value || typeof value !== 'string') return fallback; try { return JSON.parse(value); } catch { return fallback; } }
function num(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}
function zeroToken() { return { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }; }
function addToken(acc, token) {
  acc.total += token.total || 0;
  acc.input += token.input || 0;
  acc.output += token.output || 0;
  acc.reasoning += token.reasoning || 0;
  acc.cacheRead += token.cacheRead || 0;
  acc.cacheWrite += token.cacheWrite || 0;
  return acc;
}
function tokenMetric(sources, names, cacheNames = []) {
  for (const source of sources) {
    const cacheValue = cacheNames.length ? num(...cacheNames.map((name) => source?.cache?.[name])) : 0;
    if (cacheValue) return cacheValue;
    const value = num(...names.map((name) => source?.[name]));
    if (value) return value;
  }
  return 0;
}
function pickToken(data) {
  const sources = [data?.tokens || {}, data?.usage || {}, data || {}];
  const input = tokenMetric(sources, ['input', 'inputTokens', 'input_tokens', 'prompt_tokens', 'promptTokens']);
  const output = tokenMetric(sources, ['output', 'outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens']);
  const reasoning = tokenMetric(sources, ['reasoning', 'reasoningTokens', 'reasoning_tokens']);
  // InferHub/AgentCore has emitted both snake_case and *Tokens spellings over
  // time. Keep the aliases in the same fallback chain so an SDK shape change
  // does not make cache usage disappear from the dashboard.
  const cacheRead = tokenMetric(sources, ['cacheRead', 'cache_read', 'cacheReadTokens', 'cache_read_tokens', 'cached_tokens'], ['read', 'cache_read', 'readTokens', 'cacheReadTokens']);
  const cacheWrite = tokenMetric(sources, ['cacheWrite', 'cache_write', 'cacheWriteTokens', 'cache_creation_input_tokens', 'cache_write_tokens'], ['write', 'cache_write', 'writeTokens', 'cacheWriteTokens']);
  const total = tokenMetric(sources, ['total', 'totalTokens', 'total_tokens']) || input + output + reasoning + cacheRead + cacheWrite;
  return { total, input, output, reasoning, cacheRead, cacheWrite };
}
function messagePartKey(source, id) { return source ? `${source}:${id}` : id; }
function partsForMessage(row, partMap = new Map()) {
  const key = messagePartKey(row.source, row.id);
  return partMap.get(key) || partMap.get(row.id) || [];
}
const messageAnalysisCaches = new WeakMap();
function analyzeMessage(row, partMap = new Map()) {
  if (!row || typeof row !== 'object') {
    return {
      data: {}, token: zeroToken(), meaningful: false, placeholder: false,
      partToken: null, partTokenCount: 0, tokenSource: 'none', hasError: false, hasStepFinish: false,
      model: 'unknown', provider: 'unknown', performance: null, error: null,
    };
  }
  let cache = messageAnalysisCaches.get(partMap);
  if (!cache) { cache = new WeakMap(); messageAnalysisCaches.set(partMap, cache); }
  const cached = cache.get(row);
  if (cached) return cached;

  const data = parseJsonSafe(row.data, {});
  const parts = partsForMessage(row, partMap);
  const partToken = zeroToken();
  let partTokenCount = 0;
  let seenPartIds = new Set();
  let hasStepFinish = false;
  let firstEventMs = null;
  let firstContentMs = null;
  for (const part of parts) {
    const partData = parseJsonSafe(part.data, {});
    const type = partData.type || '';
    if (type === 'step-finish') {
      const partId = String(part.id || '');
      if (partId && seenPartIds.has(partId)) continue;
      if (partId) seenPartIds.add(partId);
      hasStepFinish = true;
      if (partData.tokens || partData.usage) {
        addToken(partToken, pickToken(partData));
        partTokenCount += 1;
      }
    }
    if (part.time_created >= row.time_created) {
      const latency = part.time_created - row.time_created;
      if (firstEventMs == null) firstEventMs = latency;
      if (!['step-start', 'step-finish'].includes(type) && firstContentMs == null) firstContentMs = latency;
    }
  }
  const token = partTokenCount ? partToken : pickToken(data);
  const tokenSource = partTokenCount ? 'step-finish' : (Object.keys(data?.tokens || data?.usage || {}).length ? 'message' : 'none');
  const hasError = hasMessageError(data);
  const completed = hasCompletedTime(data);
  const placeholder = data.role === 'assistant'
    && ['total', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']
      .every((key) => !(Number(token?.[key]) > 0))
    && !hasError && !completed && !hasStepFinish;
  const meaningful = data.role === 'assistant' && !placeholder;
  const model = data.modelID || data.model?.modelID || 'unknown';
  const provider = data.providerID || data.model?.providerID || 'unknown';
  let performance = null;
  if (meaningful) {
    const time = data.time || {};
    const created = Number(time.created || row.time_created || 0);
    const completedAt = Number(time.completed || row.time_updated || 0);
    const latencyMs = created && completedAt && completedAt >= created ? completedAt - created : null;
    performance = {
      id: row.id,
      sessionId: row.session_id,
      model,
      provider,
      created,
      completed: completedAt,
      latencyMs,
      firstEventMs,
      firstContentMs,
      ttftMs: null,
      ttftEvent: null,
      outputTokensPerSec: latencyMs && latencyMs > 0 ? token.output / (latencyMs / 1000) : null,
      totalTokensPerSec: latencyMs && latencyMs > 0 ? token.total / (latencyMs / 1000) : null,
      finish: data.finish || null,
      error: Boolean(data.error),
      tokens: token,
    };
  }
  const result = {
    data,
    token,
    partToken: partTokenCount ? partToken : null,
    partTokenCount,
    tokenSource,
    meaningful,
    placeholder,
    hasError,
    hasStepFinish,
    firstEventMs,
    firstContentMs,
    model,
    provider,
    performance,
    error: extractError(data),
  };
  cache.set(row, result);
  return result;
}
function partTokensForMessage(row, partMap = new Map()) {
  return analyzeMessage(row, partMap).partToken;
}
function hasMessageError(data = {}) {
  const value = data?.error;
  if (value == null || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value;
  return typeof value === 'object';
}
function hasCompletedTime(data = {}) {
  const value = Number(data?.time?.completed);
  return Number.isFinite(value) && value > 0;
}
function hasStepFinishForMessage(row, partMap = new Map()) {
  return analyzeMessage(row, partMap).hasStepFinish;
}
function isPlaceholderAssistant(row, partMap = new Map()) {
  return analyzeMessage(row, partMap).placeholder;
}
function isMeaningfulAssistant(row, partMap = new Map()) {
  return analyzeMessage(row, partMap).meaningful;
}
function tokenForMessage(row, partMap = new Map()) {
  return analyzeMessage(row, partMap).token;
}
function sumTokens(rows, partMap = new Map()) {
  const acc = { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0 };
  for (const row of rows) {
    const analysis = analyzeMessage(row, partMap);
    if (!analysis.meaningful) continue;
    addToken(acc, analysis.token);
    acc.messages += 1;
    if (analysis.hasError) acc.errors += 1;
  }
  return cacheMetrics.withCacheHitMetrics(acc);
}
function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return percentileSorted(nums, p);
}
function percentileSorted(nums, p) {
  if (!nums.length) return null;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[idx];
}
function summarize(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return { count: 0, min: null, avg: null, p50: null, p90: null, p95: null, p99: null, max: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    min: nums[0],
    avg: sum / nums.length,
    p50: percentileSorted(nums, 50),
    p90: percentileSorted(nums, 90),
    p95: percentileSorted(nums, 95),
    p99: percentileSorted(nums, 99),
    max: nums[nums.length - 1],
  };
}
function buildPartMap(parts) {
  const map = new Map();
  for (const part of parts || []) {
    const key = messagePartKey(part.source, part.message_id);
    const arr = map.get(key) || [];
    arr.push(part);
    map.set(key, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.time_created - b.time_created);
  return map;
}
function rowSessionKey(row) { return `${row.source || ''}:${row.session_id || row.id || ''}`; }
function sessionKey(session) { return `${session.source || ''}:${session.id || ''}`; }
function buildSessionUsageMap(messages, partMap = new Map(), since = 0) {
  const map = new Map();
  for (const row of messages || []) {
    if (row.time_created < since) continue;
    const analysis = analyzeMessage(row, partMap);
    const data = analysis.data;
    const key = rowSessionKey(row);
    const prev = map.get(key) || {
      total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
      userTurns: 0, modelCalls: 0, errors: 0, firstAt: row.time_created, lastAt: row.time_updated || row.time_created,
      byModel: new Map(),
    };
    prev.firstAt = Math.min(prev.firstAt, row.time_created);
    prev.lastAt = Math.max(prev.lastAt, row.time_updated || row.time_created);
    if (data.role === 'user') {
      prev.userTurns += 1;
    } else if (data.role === 'assistant') {
      if (!analysis.meaningful) { map.set(key, prev); continue; }
      addToken(prev, analysis.token);
      prev.modelCalls += 1;
      if (analysis.hasError) prev.errors += 1;
      const model = analysis.model;
      const provider = analysis.provider;
      const modelKey = `${provider} / ${model}`;
      const modelPrev = prev.byModel.get(modelKey) || { provider, model, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, calls: 0, errors: 0 };
      addToken(modelPrev, analysis.token);
      modelPrev.calls += 1;
      if (analysis.hasError) modelPrev.errors += 1;
      prev.byModel.set(modelKey, modelPrev);
    }
    map.set(key, prev);
  }
  for (const value of map.values()) {
    value.models = [...value.byModel.values()].sort((a, b) => b.total - a.total);
    value.models.forEach((model) => cacheMetrics.withCacheHitMetrics(model));
    value.topModel = value.models[0] || null;
    delete value.byModel;
    cacheMetrics.withCacheHitMetrics(value);
  }
  return map;
}
function toolStats(parts, since = 0) {
  const byName = new Map();
  const byType = new Map();
  let totalToolCalls = 0;
  for (const part of parts || []) {
    if (part.time_created < since) continue;
    const data = parseJsonSafe(part.data, {});
    const type = data.type || 'unknown';
    byType.set(type, (byType.get(type) || 0) + 1);
    if (type !== 'tool') continue;
    totalToolCalls += 1;
    const name = data.tool || data.toolName || data.name || data.metadata?.tool || 'unknown';
    const prev = byName.get(name) || { name, calls: 0, errors: 0, firstSeen: part.time_created, lastSeen: part.time_created };
    prev.calls += 1;
    if (data.error || data.state?.status === 'error') prev.errors += 1;
    prev.firstSeen = Math.min(prev.firstSeen, part.time_created);
    prev.lastSeen = Math.max(prev.lastSeen, part.time_created);
    byName.set(name, prev);
  }
  return { totalToolCalls, byName: [...byName.values()].sort((a, b) => b.calls - a.calls), partTypes: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count) };
}
function buildTtftMap(messages, ttftEvents, partMap = new Map()) {
  const map = new Map();
  const assistantsBySession = new Map();
  for (let index = 0; index < (messages || []).length; index += 1) {
    const row = messages[index];
    const analysis = analyzeMessage(row, partMap);
    if (!analysis.meaningful) continue;
    const created = Number(analysis.data.time?.created || row.time_created || 0);
    const list = assistantsBySession.get(row.session_id) || [];
    list.push({ row, created, index });
    assistantsBySession.set(row.session_id, list);
  }
  for (const list of assistantsBySession.values()) list.sort((a, b) => a.created - b.created || a.index - b.index);
  const nearestAssistant = (list, target) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (list[middle].created < target) low = middle + 1;
      else high = middle;
    }
    const candidates = [list[low - 1], list[low]].filter(Boolean);
    return candidates.reduce((best, candidate) => {
      const distance = Math.abs(target - candidate.created);
      if (distance >= 10 * 60 * 1000) return best;
      if (!best || distance < best.distance || (distance === best.distance && candidate.index < best.item.index)) {
        return { item: candidate, distance };
      }
      return best;
    }, null)?.item || null;
  };
  for (const e of ttftEvents) {
    const target = Number(e.firstTokenAt || 0);
    const candidate = Number.isFinite(target) ? nearestAssistant(assistantsBySession.get(e.sessionId) || [], target) : null;
    if (candidate && !map.has(candidate.row.id)) map.set(candidate.row.id, e);
  }
  return map;
}
function firstPartLatency(row, partMap, mode = 'any') {
  const analysis = analyzeMessage(row, partMap);
  return mode === 'content' ? analysis.firstContentMs : analysis.firstEventMs;
}
function messagePerf(row, partMap, ttftMap = new Map()) {
  const analysis = analyzeMessage(row, partMap);
  if (!analysis.meaningful) return null;
  const firstEventMs = firstPartLatency(row, partMap, 'any');
  const firstContentMs = firstPartLatency(row, partMap, 'content');
  const ttftEvent = ttftMap.get(row.id) || null;
  return { ...analysis.performance, firstEventMs, firstContentMs, ttftMs: ttftEvent ? ttftEvent.ttftMs : null, ttftEvent };
}
function modelStats(rows, since = 0, partMap = new Map(), ttftMap = new Map()) {
  const map = new Map();
  for (const row of rows) {
    if (row.time_created < since) continue;
    const analysis = analyzeMessage(row, partMap);
    if (!analysis.meaningful) continue;
    const model = analysis.model;
    const provider = analysis.provider;
    const key = `${provider} / ${model}`;
    const prev = map.get(key) || { provider, model, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, _latencies: [], _firstContent: [], _outTps: [], _totalTps: [], _ttft: [] };
    addToken(prev, analysis.token); prev.messages += 1;
    if (analysis.hasError) prev.errors += 1;
    const perf = messagePerf(row, partMap, ttftMap);
    if (perf) {
      if (Number.isFinite(perf.latencyMs)) prev._latencies.push(perf.latencyMs);
      if (Number.isFinite(perf.firstContentMs)) prev._firstContent.push(perf.firstContentMs);
      if (Number.isFinite(perf.ttftMs)) prev._ttft.push(perf.ttftMs);
      if (Number.isFinite(perf.outputTokensPerSec)) prev._outTps.push(perf.outputTokensPerSec);
      if (Number.isFinite(perf.totalTokensPerSec)) prev._totalTps.push(perf.totalTokensPerSec);
    }
    map.set(key, prev);
  }
  return [...map.entries()].map(([name, value]) => {
    const latency = summarize(value._latencies);
    const firstContent = summarize(value._firstContent);
    const ttft = summarize(value._ttft);
    const outputTokensPerSec = summarize(value._outTps);
    const totalTokensPerSec = summarize(value._totalTps);
    delete value._latencies; delete value._firstContent; delete value._outTps; delete value._totalTps; delete value._ttft;
    return cacheMetrics.withCacheHitMetrics({ name, ...value, performance: { latency, ttft, firstContentApprox: firstContent, outputTokensPerSec, totalTokensPerSec } });
  }).sort((a, b) => b.total - a.total);
}
function performanceStats(rows, partMap, since = 0, ttftMap = new Map()) {
  const perfs = rows.filter((r) => r.time_created >= since).map((r) => messagePerf(r, partMap, ttftMap)).filter(Boolean);
  const completed = perfs.filter((p) => Number.isFinite(p.latencyMs));
  const errors = perfs.filter((p) => p.error).length;
  return { note: 'TTFT 来自 CodeArts kernel 日志 Infer stream first token generated；firstEventApprox/firstContentApprox 来自 part 表近似。', samples: perfs.length, completed: completed.length, errors, errorRate: perfs.length ? errors / perfs.length : 0, latency: summarize(completed.map((p) => p.latencyMs)), ttft: summarize(perfs.map((p) => p.ttftMs)), firstEventApprox: summarize(perfs.map((p) => p.firstEventMs)), firstContentApprox: summarize(perfs.map((p) => p.firstContentMs)), outputTokensPerSec: summarize(completed.map((p) => p.outputTokensPerSec)), totalTokensPerSec: summarize(completed.map((p) => p.totalTokensPerSec)), slowest: [...completed].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 8), fastest: [...completed].sort((a, b) => a.latencyMs - b.latencyMs).slice(0, 5) };
}
function queueStats(events, since = 0) {
  const filtered = (events || []).filter((e) => Number.isFinite(e.durationMs) && (e.end || e.start || 0) >= since);
  const byModel = new Map();
  for (const e of filtered) {
    const key = e.model || 'unknown';
    const prev = byModel.get(key) || { model: key, samples: 0, totalMs: 0, maxMs: 0, queueLengthMax: 0, queuePositionStartMax: 0 };
    prev.samples += 1;
    prev.totalMs += e.durationMs || 0;
    prev.maxMs = Math.max(prev.maxMs, e.durationMs || 0);
    prev.queueLengthMax = Math.max(prev.queueLengthMax, e.queueLengthMax || 0);
    prev.queuePositionStartMax = Math.max(prev.queuePositionStartMax, e.queuePositionStart || 0);
    byModel.set(key, prev);
  }
  const durations = summarize(filtered.map((e) => e.durationMs));
  const totalMs = filtered.reduce((sum, e) => sum + (e.durationMs || 0), 0);
  return {
    samples: filtered.length,
    totalMs,
    avg: durations.avg,
    p50: durations.p50,
    p95: durations.p95,
    max: durations.max,
    latest: filtered.length ? [...filtered].sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0))[0] : null,
    byModel: [...byModel.values()].map((m) => ({ ...m, avgMs: m.samples ? m.totalMs / m.samples : null })).sort((a, b) => b.totalMs - a.totalMs),
  };
}
function extractError(data) {
  if (!data || !data.error) return null;
  const err = data.error;
  const detail = err.data || {};
  let message = detail.message || err.message || err.name || '未知错误';
  if (typeof message !== 'string') message = JSON.stringify(message);
  let balance = null;
  let required = null;
  const balanceMatch = message.match(/剩余额度[:：]\s*[＄$]?\s*([0-9.]+)/);
  const requiredMatch = message.match(/需要预扣费额度[:：]\s*[＄$]?\s*([0-9.]+)/);
  if (balanceMatch) balance = Number(balanceMatch[1]);
  if (requiredMatch) required = Number(requiredMatch[1]);
  if (balance == null && typeof detail.responseBody === 'string') {
    const bodyBalance = detail.responseBody.match(/剩余额度[:：]\s*[＄$]?\s*([0-9.]+)/);
    if (bodyBalance) balance = Number(bodyBalance[1]);
  }
  return { name: err.name || 'Error', statusCode: detail.statusCode || null, code: detail.code || null, message, balance, required };
}
function latestErrors(rows, limit = 8) {
  const out = [];
  for (const row of [...rows].sort((a, b) => b.time_created - a.time_created)) {
    const data = parseJsonSafe(row.data, {});
    const error = extractError(data);
    if (!error) continue;
    out.push({ time: row.time_created, sessionId: row.session_id, model: data.modelID || data.model?.modelID || 'unknown', ...error });
    if (out.length >= limit) break;
  }
  return out;
}
function inferBalance(errors) { for (const e of errors) if (Number.isFinite(e.balance)) return { value: e.balance, required: e.required, source: 'latest_error', time: e.time, message: e.message }; return null; }
function bucketStart(ms, bucketMs, bucketOffsetMs = 0) { return Math.floor((ms + bucketOffsetMs) / bucketMs) * bucketMs - bucketOffsetMs; }
function queueTrendStats(events, since, bucketMs) {
  const buckets = new Map();
  for (const e of events || []) {
    const at = Number(e.start || e.end || 0);
    if (!Number.isFinite(at) || at < since || !Number.isFinite(e.durationMs)) continue;
    const key = bucketStart(at, bucketMs);
    const b = buckets.get(key) || { start: key, end: key + bucketMs, queue: 0, queueMs: 0, totalMs: 0, avgMs: null, maxMs: 0, samples: 0, queueLengthMax: 0, queuePositionStartMax: 0 };
    b.queueMs += e.durationMs || 0;
    b.totalMs += e.durationMs || 0;
    b.maxMs = Math.max(b.maxMs || 0, e.durationMs || 0);
    b.samples += 1;
    b.queueLengthMax = Math.max(b.queueLengthMax || 0, e.queueLengthMax || 0);
    b.queuePositionStartMax = Math.max(b.queuePositionStartMax || 0, e.queuePositionStart || 0);
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start).map((b) => { const avgMs = b.samples ? b.totalMs / b.samples : null; return { ...b, avgMs, queue: avgMs || 0, label: new Date(b.start).toLocaleString('zh-CN', { hour12: false }) }; });
}
function trendStats(messages, partMap, since, bucketMs, bucketOffsetMs = 0) {
  const buckets = new Map();
  for (const row of messages) {
    if (row.time_created < since) continue;
    const analysis = analyzeMessage(row, partMap);
    if (!analysis.meaningful) continue;
    const key = bucketStart(row.time_created, bucketMs, bucketOffsetMs);
    const b = buckets.get(key) || { start: key, end: key + bucketMs, total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, messages: 0, errors: 0, latencies: [] };
    addToken(b, analysis.token); b.messages += 1;
    if (analysis.hasError) b.errors += 1;
    const perf = messagePerf(row, partMap);
    if (perf && Number.isFinite(perf.latencyMs)) b.latencies.push(perf.latencyMs);
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start).map((b) => { const lat = summarize(b.latencies); delete b.latencies; return cacheMetrics.withCacheHitMetrics({ ...b, label: new Date(b.start).toLocaleString('zh-CN', { hour12: false }), latencyAvg: lat.avg, latencyP95: lat.p95 }); });
}
function buildTrends(messages, partMap, timestamp) {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  return { hourly24h: trendStats(messages, partMap, timestamp - 24 * hour, hour), daily14d: trendStats(messages, partMap, timestamp - 14 * day, day) };
}
function buildQueueTrends(events, timestamp) {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  return { hourly24h: queueTrendStats(events, timestamp - 24 * hour, hour), daily14d: queueTrendStats(events, timestamp - 14 * day, day) };
}
module.exports = { parseJsonSafe, pickToken, analyzeMessage, partTokensForMessage, tokenForMessage, isMeaningfulAssistant, sumTokens, percentile, percentileSorted, summarize, buildPartMap, buildSessionUsageMap, toolStats, buildTtftMap, firstPartLatency, messagePerf, modelStats, performanceStats, queueStats, extractError, latestErrors, inferBalance, queueTrendStats, trendStats, buildTrends, buildQueueTrends, cacheMetrics };
