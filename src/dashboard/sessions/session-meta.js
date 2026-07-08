function sessionKeyFor(session){ return `${session.source || ''}:${session.id || ''}`; }
function metaForSession(item){ return sessionMeta[sessionKeyFor(item)] || { tags: [], note: '' }; }
function normalizeTags(value){ return String(value || '').split(/[,，]/u).map((x) => x.trim()).filter(Boolean).slice(0, 8); }
function sessionTagsHtml(item, limit = 4){ const tags = metaForSession(item).tags || []; if(!tags.length) return `<span class="muted">-</span>`; return `<div class="session-tags">${tags.slice(0, limit).map((tag) => `<span class="session-tag">${esc(tag)}</span>`).join('')}${tags.length > limit ? `<span class="session-tag more">+${tags.length - limit}</span>` : ''}</div>`; }
