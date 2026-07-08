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
  const items = sessionCacheGovernanceCandidates(s, 6);
  const stats = sessionCacheGovernanceStats(items);
  const maxScore = Math.max(1, ...items.map((x) => x.score || 0));
  const top = items[0];
  const body = items.length ? items.map((x, index) => {
    const key = sessionKeyFor(x.item);
    const hit = Math.max(0, Math.min(100, x.hit || 0));
    const scoreW = Math.max(5, Math.min(100, ((x.score || 0) / maxScore) * 100));
    return `<button class="cache-governance-row ${key === selectedSessionId ? 'active' : ''} ${x.health.tone}" data-session-select="${esc(key)}"><span class="cache-governance-rank">${index + 1}</span><span class="cache-governance-main"><b>${esc(x.item.title || '(untitled)')}</b><em>${esc(sessionProjectName(x.item))} / ${x.health.label}</em></span><span class="cache-governance-metrics"><strong>${compact(x.score)}</strong><small>${TXT.cacheHitRate} ${cacheHitText(x.usage)}</small></span><i style="--score:${scoreW}%; --hit:${hit}%"></i></button>`;
  }).join('') : `<div class="cache-governance-empty">${TXT.cacheGovernanceEmpty}</div>`;
  return `<section class="cache-governance"><div class="cache-governance-head"><div><b>${TXT.cacheGovernance}</b><span>${TXT.cacheGovernanceHint}</span></div><div class="cache-governance-actions"><button data-session-cache-governance="focus">${TXT.cacheGovernanceFocus}</button><button data-session-cache-governance="copy">${TXT.cacheGovernanceReport}</button></div></div><div class="cache-governance-kpis"><div><span>${TXT.cacheGovernanceTop}</span><b>${top ? esc(top.item.title || '(untitled)') : TXT.noData}</b><em>${top ? `${TXT.cacheOpportunityScore} ${compact(top.score)}` : TXT.cacheGovernanceEmpty}</em></div><div><span>${TXT.cacheGovernancePotential}</span><b>${compact(stats.potential)}</b><em>${TXT.cacheWastedTokens}</em></div><div><span>${TXT.cacheGovernanceWeighted}</span><b>${cacheHitText(stats.usage)}</b><em>${TXT.cacheHitBasis} ${cacheHitBasis(stats.usage)}</em></div><div><span>${TXT.cacheGovernanceCandidates}</span><b>${n(items.length)}</b><em>${TXT.visibleSessions}</em></div></div><div class="cache-governance-list">${body}</div></section>`;
}
function sessionCacheOpportunityHtml(s){
  const candidates = (s.sessions || [])
    .filter((item) => (sourceFilter === 'all' || sourceKey(item) === sourceFilter) && (sessionProjectFilter === 'all' || sessionProjectKey(item) === sessionProjectFilter) && sessionStatusMatches(item))
    .map((item) => ({ item, usage: item.usage || {}, hit: cacheHitRate(item.usage || {}) }))
    .filter((x) => Number(x.usage.total || 0) > 0 && (x.hit == null || x.hit < 35))
    .sort((a, b) => (b.usage.total || 0) - (a.usage.total || 0))
    .slice(0, 5);
  if(!candidates.length) return '';
  const max = Math.max(1, ...candidates.map((x) => x.usage.total || 0));
  return `<div class="session-cache-opportunities"><div class="session-rail-head"><b>${TXT.cacheOpportunities}</b><span>${TXT.cacheOpportunityHint}</span></div><div class="cache-opportunity-list">${candidates.map(({ item, usage, hit }) => { const key = sessionKeyFor(item); const health = cacheHealth(usage); return `<button data-session-select="${esc(key)}" class="${key === selectedSessionId ? 'active' : ''}"><span><b>${esc(item.title || '(untitled)')}</b><em>${esc(sessionProjectName(item))} / ${TXT.cacheHitRate} ${cacheHitText(usage)} / ${health.label}</em></span><strong>${compact(usage.total || 0)}</strong><i style="--w:${Math.max(5, Math.min(100, ((usage.total || 0) / max) * 100))}%; --hit:${Math.max(0, Math.min(100, hit || 0))}%"></i></button>`; }).join('')}</div></div>`;
}
