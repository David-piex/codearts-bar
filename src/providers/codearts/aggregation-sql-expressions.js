'use strict';

const agg = require('../../core/aggregator');
const { jsonExtractExpr, jsonTypeExpr, messageErrorExpr } = require('./sources');

const TOKEN_PATHS = {
  input: [
    '$.tokens.input', '$.tokens.inputTokens', '$.tokens.input_tokens',
    '$.tokens.prompt_tokens', '$.tokens.promptTokens',
    '$.usage.input', '$.usage.inputTokens', '$.usage.input_tokens',
    '$.usage.prompt_tokens', '$.usage.promptTokens',
  ],
  output: [
    '$.tokens.output', '$.tokens.outputTokens', '$.tokens.output_tokens',
    '$.tokens.completion_tokens', '$.tokens.completionTokens',
    '$.usage.output', '$.usage.outputTokens', '$.usage.output_tokens',
    '$.usage.completion_tokens', '$.usage.completionTokens',
  ],
  reasoning: [
    '$.tokens.reasoning', '$.tokens.reasoningTokens', '$.tokens.reasoning_tokens',
    '$.usage.reasoning', '$.usage.reasoningTokens', '$.usage.reasoning_tokens',
  ],
  cacheRead: [
    '$.tokens.cache.read', '$.tokens.cache.cache_read',
    '$.tokens.cacheRead', '$.tokens.cache_read',
    '$.tokens.cached_tokens', '$.tokens.cache_read_tokens',
    '$.usage.cache.read', '$.usage.cache.cache_read',
    '$.usage.cacheRead', '$.usage.cache_read',
    '$.usage.cached_tokens', '$.usage.cache_read_tokens',
  ],
  cacheWrite: [
    '$.tokens.cache.write', '$.tokens.cache.cache_write',
    '$.tokens.cacheWrite', '$.tokens.cache_write',
    '$.tokens.cache_creation_input_tokens', '$.tokens.cache_write_tokens',
    '$.usage.cache.write', '$.usage.cache.cache_write',
    '$.usage.cacheWrite', '$.usage.cache_write',
    '$.usage.cache_creation_input_tokens', '$.usage.cache_write_tokens',
  ],
  total: [
    '$.tokens.total', '$.tokens.totalTokens', '$.tokens.total_tokens',
    '$.usage.total', '$.usage.totalTokens', '$.usage.total_tokens',
  ],
};

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sqlNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function jsonNumberExpr(alias, paths) {
  return `coalesce(${paths.map((p) => `nullif(cast(json_extract(${alias}.data, '${p}') as real), 0)`).join(', ')}, 0)`;
}

function tokenFieldExpr(alias, field) {
  if (field !== 'total') return jsonNumberExpr(alias, TOKEN_PATHS[field]);
  const explicit = jsonNumberExpr(alias, TOKEN_PATHS.total);
  const sum = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'].map((k) => tokenFieldExpr(alias, k)).join(' + ');
  return `coalesce(nullif((${explicit}), 0), (${sum}), 0)`;
}

function timeExpr(alias, jsonPath, column) {
  return `coalesce(nullif(cast(json_extract(${alias}.data, '${jsonPath}') as real), 0), ${alias}.${column})`;
}

function cteMaterialized(options = {}) {
  return options.materialized ? ' as materialized ' : ' as ';
}

function assistantTokenCtes(tables = [], whereSql = '1=1', options = {}) {
  const hasPart = tables.includes('part');
  const mat = cteMaterialized(options);
  const ctes = [`filtered_messages${mat}(
      select m.*
      from message m
      where ${whereSql}
    )`];
  if (hasPart) {
    ctes.push(`part_tokens${mat}(
      select
        p.message_id,
        sum(${tokenFieldExpr('p', 'total')}) as total,
        sum(${tokenFieldExpr('p', 'input')}) as input,
        sum(${tokenFieldExpr('p', 'output')}) as output,
        sum(${tokenFieldExpr('p', 'reasoning')}) as reasoning,
        sum(${tokenFieldExpr('p', 'cacheRead')}) as cacheRead,
        sum(${tokenFieldExpr('p', 'cacheWrite')}) as cacheWrite
      from part p
      join filtered_messages fm on fm.id = p.message_id
      where ${jsonExtractExpr('p.data', '$.type')} = 'step-finish'
        and (${jsonTypeExpr('p.data', '$.tokens')} is not null or ${jsonTypeExpr('p.data', '$.usage')} is not null)
      group by p.message_id
    )`);
  }
  ctes.push(`assistant_tokens${mat}(
    select
      m.id,
      m.session_id,
      m.time_created,
      m.time_updated,
      m.data,
      ${hasPart ? `coalesce(pt.total, ${tokenFieldExpr('m', 'total')})` : tokenFieldExpr('m', 'total')} as total,
      ${hasPart ? `coalesce(pt.input, ${tokenFieldExpr('m', 'input')})` : tokenFieldExpr('m', 'input')} as input,
      ${hasPart ? `coalesce(pt.output, ${tokenFieldExpr('m', 'output')})` : tokenFieldExpr('m', 'output')} as output,
      ${hasPart ? `coalesce(pt.reasoning, ${tokenFieldExpr('m', 'reasoning')})` : tokenFieldExpr('m', 'reasoning')} as reasoning,
      ${hasPart ? `coalesce(pt.cacheRead, ${tokenFieldExpr('m', 'cacheRead')})` : tokenFieldExpr('m', 'cacheRead')} as cacheRead,
      ${hasPart ? `coalesce(pt.cacheWrite, ${tokenFieldExpr('m', 'cacheWrite')})` : tokenFieldExpr('m', 'cacheWrite')} as cacheWrite,
      ${messageErrorExpr('m.data')} as error,
      coalesce(json_extract(m.data, '$.providerID'), json_extract(m.data, '$.model.providerID'), 'unknown') as provider,
      coalesce(json_extract(m.data, '$.modelID'), json_extract(m.data, '$.model.modelID'), 'unknown') as model,
      ${timeExpr('m', '$.time.created', 'time_created')} as message_created,
      ${timeExpr('m', '$.time.completed', 'time_updated')} as message_completed
    from filtered_messages m
    ${hasPart ? 'left join part_tokens pt on pt.message_id = m.id' : ''}
  )`);
  return `with ${ctes.join(',\n')}`;
}

function usageColumns(predicate = '1=1') {
  const guard = predicate ? `case when ${predicate} then` : '';
  const end = predicate ? ' else 0 end' : '';
  const oneEnd = predicate ? ' else 0 end' : '';
  return [
    `sum(${guard} total${end}) as total`,
    `sum(${guard} input${end}) as input`,
    `sum(${guard} output${end}) as output`,
    `sum(${guard} reasoning${end}) as reasoning`,
    `sum(${guard} cacheRead${end}) as cacheRead`,
    `sum(${guard} cacheWrite${end}) as cacheWrite`,
    `sum(${predicate ? `case when ${predicate} then 1${oneEnd}` : '1'}) as messages`,
    `sum(${guard} error${end}) as errors`,
  ].join(',\n');
}

function usageSelect(prefix, predicate = '1=1') {
  const guard = predicate ? `case when ${predicate} then` : '';
  const end = predicate ? ' else 0 end' : '';
  const oneEnd = predicate ? ' else 0 end' : '';
  return [
    `sum(${guard} total${end}) as ${prefix}_total`,
    `sum(${guard} input${end}) as ${prefix}_input`,
    `sum(${guard} output${end}) as ${prefix}_output`,
    `sum(${guard} reasoning${end}) as ${prefix}_reasoning`,
    `sum(${guard} cacheRead${end}) as ${prefix}_cacheRead`,
    `sum(${guard} cacheWrite${end}) as ${prefix}_cacheWrite`,
    `sum(${predicate ? `case when ${predicate} then 1${oneEnd}` : '1'}) as ${prefix}_messages`,
    `sum(${guard} error${end}) as ${prefix}_errors`,
  ].join(',\n');
}

function usageFromRow(row = {}, prefix) {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: sqlNumber(row[`${prefix}_total`]),
    input: sqlNumber(row[`${prefix}_input`]),
    output: sqlNumber(row[`${prefix}_output`]),
    reasoning: sqlNumber(row[`${prefix}_reasoning`]),
    cacheRead: sqlNumber(row[`${prefix}_cacheRead`]),
    cacheWrite: sqlNumber(row[`${prefix}_cacheWrite`]),
    messages: sqlNumber(row[`${prefix}_messages`]),
    errors: sqlNumber(row[`${prefix}_errors`]),
  });
}

function rowUsage(row = {}) {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: sqlNumber(row.total),
    input: sqlNumber(row.input),
    output: sqlNumber(row.output),
    reasoning: sqlNumber(row.reasoning),
    cacheRead: sqlNumber(row.cacheRead),
    cacheWrite: sqlNumber(row.cacheWrite),
    messages: sqlNumber(row.messages),
    errors: sqlNumber(row.errors),
  });
}

function usageFromAggregateRow(row = {}) {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: sqlNumber(row.total),
    input: sqlNumber(row.input),
    output: sqlNumber(row.output),
    reasoning: sqlNumber(row.reasoning),
    cacheRead: sqlNumber(row.cacheRead),
    cacheWrite: sqlNumber(row.cacheWrite),
    messages: sqlNumber(row.messages),
    errors: sqlNumber(row.errors),
  });
}
function emptyAggregateUsage() {
  return agg.cacheMetrics.withCacheHitMetrics({
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    messages: 0,
    errors: 0,
  });
}

module.exports = {
  safeNumber,
  sqlNumber,
  assistantTokenCtes,
  usageColumns,
  usageSelect,
  usageFromRow,
  rowUsage,
  usageFromAggregateRow,
};
