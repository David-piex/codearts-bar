function sessionCacheGovernanceCandidates(s, limit = 6){
  return (s.sessions || [])
    .filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter) && sessionStatusMatches(item))
    .map((item) => {
      const usage = item.usage || {};
      const hit = cacheHitRate(usage);
      const score = cacheOpportunityScore(usage);
      const health = cacheHealth(usage);
      const reason = hit == null ? TXT.cacheActionNone : hit < 25 ? TXT.cacheActionLow : hit < 60 ? TXT.cacheActionMid : TXT.cacheActionHigh;
      return { item, usage, hit, score, health, reason };
    })
    .filter((x) => Number(x.usage.total || 0) > 0 && (x.hit == null || x.hit < 60 || x.score > 10000))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.usage.total || 0) - (a.usage.total || 0))
    .slice(0, limit);
}
function sessionCacheGovernanceStats(items){
  const usage = items.reduce((acc, x) => addSessionUsage(acc, x.usage || {}), { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, calls: 0 });
  const potential = items.reduce((sum, x) => sum + Number(x.score || 0), 0);
  return { usage, potential, hit: cacheHitRate(usage) };
}
function sessionCacheGovernanceReport(s){
  const items = sessionCacheGovernanceCandidates(s, 12);
  const stats = sessionCacheGovernanceStats(items);
  const lines = [
    `# ${TXT.cacheGovernance}`,
    '',
    `- ${TXT.project}: ${labelForProjectFilter(s)}`,
    `- ${TXT.source}: ${sourceFilter === 'all' ? TXT.allSource : sourceLabelFor(s, sourceFilter)}`,
    `- ${TXT.cacheGovernanceCandidates}: ${n(items.length)}`,
    `- ${TXT.cacheGovernanceWeighted}: ${cacheHitText(stats.usage)}`,
    `- ${TXT.cacheGovernancePotential}: ${compact(stats.potential)} token`,
    '',
    `| ${TXT.session} | ${TXT.project} | ${TXT.total} | ${TXT.cacheHitRate} | ${TXT.cacheOpportunityScore} | ${TXT.cacheGovernanceReason} |`,
    '|---|---|---:|---:|---:|---|',
  ];
  if(!items.length) lines.push(`| ${TXT.noData} |  | 0 | N/A | 0 | ${TXT.cacheGovernanceEmpty} |`);
  for(const x of items){
    lines.push(`| ${String(x.item.title || '(untitled)').replace(/\|/g, '/')} | ${String(sessionProjectName(x.item)).replace(/\|/g, '/')} | ${n(x.usage.total || 0)} | ${cacheHitText(x.usage)} | ${compact(x.score)} | ${String(x.reason).replace(/\|/g, '/')} |`);
  }
  return lines.join('\n');
}
function renderSessionCacheGovernance(s){
  // Cache candidates are intentionally hidden; cache hit metrics remain available elsewhere.
  return '';
}
function sessionCacheOpportunityHtml(s){
  return '';
}
