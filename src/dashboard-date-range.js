function dateLabel(msValue){ const d = new Date(Number(msValue) || 0); return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
function dateFullLabel(msValue){ const d = new Date(Number(msValue) || Date.now()); return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dayStart(ts){ const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function monthStart(ts){ const d = new Date(Number(ts) || Date.now()); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function pad2(v){ return String(v).padStart(2, '0'); }
function dateTimeLocalValue(msValue){
  const d = new Date(Number(msValue) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function dateInputValue(msValue){
  const d = new Date(Number(msValue) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeInputValue(msValue){
  const d = new Date(Number(msValue) || Date.now());
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseDateTimeLocal(value){
  const msValue = new Date(String(value || '')).getTime();
  return Number.isFinite(msValue) ? msValue : null;
}
function composeDateTime(dateValue, timeValue, fallback){
  const base = new Date(Number(fallback) || Date.now());
  const parts = String(dateValue || '').split('-').map(Number);
  const t = String(timeValue || '').split(':').map(Number);
  if(parts.length === 3 && parts.every(Number.isFinite)){
    base.setFullYear(parts[0], Math.max(0, parts[1] - 1), parts[2]);
  }
  if(t.length >= 2 && Number.isFinite(t[0]) && Number.isFinite(t[1])) base.setHours(t[0], t[1], 0, 0);
  return base.getTime();
}
function normalizeCustomDateRange(s = snapshot){
  const now = Number(s?.timestamp || Date.now());
  let start = Number(customDateStart || 0);
  let end = dateRangeFollowNow ? now : Number(customDateEnd || 0);
  if(!Number.isFinite(end) || end <= 0) end = now;
  if(!Number.isFinite(start) || start <= 0) start = end - 86400000;
  if(start > end) [start, end] = [end, start];
  const maxSpan = 366 * 86400000;
  if(end - start > maxSpan) start = end - maxSpan;
  customDateStart = start;
  customDateEnd = end;
  return { start, end };
}
function validTimestamp(ts, s = snapshot){ const n = Number(ts); const now = Number(s?.timestamp || Date.now()); return Number.isFinite(n) && n >= Date.UTC(2020, 0, 1) && n <= now + 366 * 86400000; }
function bucketTitle(b, s = snapshot){ const start = Number(b?.start); if(!validTimestamp(start, s)) return TXT.unknown; const d = new Date(start); return isDayRange() ? d.toLocaleDateString('zh-CN') : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
function bucketAxisLabel(b, s = snapshot){ const start = Number(b?.start); if(!validTimestamp(start, s)) return '--'; const d = new Date(start); return isDayRange() ? d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function rangeLabel(range = rangeFilter){ range = normalizeRangeFilter(range); if(range === 'customTime'){ const r = normalizeCustomDateRange(); return `${dateLabel(r.start)} - ${dateLabel(r.end)}`; } return RANGE_LABELS[range] || range || TXT.unknown; }
function isDayRange(range = rangeFilter){ range = normalizeRangeFilter(range); if(range === 'customTime'){ const r = normalizeCustomDateRange(); return r.end - r.start > 72 * 3600000; } return range === 'all' || ['7d', '14d', '30d', '60d', '90d', '180d', '365d'].includes(range); }
function sinceForRange(s, range = rangeFilter){ range = normalizeRangeFilter(range); const now = Number(s?.timestamp || Date.now()); if(range === 'customTime') return normalizeCustomDateRange(s).start; if(range === 'all') return 0; if(range === 'today') return dayStart(now); const days = Number(String(range).replace('d', '')) || 1; return now - days * 86400000; }
function untilForRange(s, range = rangeFilter){ range = normalizeRangeFilter(range); if(range === 'customTime') return normalizeCustomDateRange(s).end; return 0; }
function ensureDateRangeDraft(){
  const r = normalizeCustomDateRange(snapshot || {});
  if(!dateRangeDraftStart) dateRangeDraftStart = r.start;
  if(!dateRangeDraftEnd) dateRangeDraftEnd = r.end;
  if(!dateRangeMonth) dateRangeMonth = monthStart(dateRangeFocus === 'end' ? dateRangeDraftEnd : dateRangeDraftStart);
}
function openDateRangePopover(){
  const r = normalizeCustomDateRange(snapshot || {});
  dateRangeDraftStart = r.start;
  dateRangeDraftEnd = r.end;
  dateRangeFocus = 'start';
  dateRangeMonth = monthStart(r.start);
  dateRangeOpen = true;
}
function setDateRangeQuick(key){
  const now = Number(snapshot?.timestamp || Date.now());
  let start = dayStart(now);
  let end = dateRangeFollowNow ? now : now;
  if(key !== 'today'){
    const days = Math.max(1, Number(String(key).replace('d', '')) || 1);
    start = now - days * 86400000;
  }
  dateRangeDraftStart = start;
  dateRangeDraftEnd = end;
  dateRangeMonth = monthStart(start);
}
function updateDateRangeDraft(which, part, value){
  ensureDateRangeDraft();
  const isStart = which === 'start';
  const base = isStart ? dateRangeDraftStart : dateRangeDraftEnd;
  const dateValue = part === 'date' ? value : dateInputValue(base);
  const timeValue = part === 'time' ? value : timeInputValue(base);
  const next = composeDateTime(dateValue, timeValue, base);
  if(isStart) dateRangeDraftStart = next; else dateRangeDraftEnd = next;
  if(dateRangeDraftStart > dateRangeDraftEnd) [dateRangeDraftStart, dateRangeDraftEnd] = [dateRangeDraftEnd, dateRangeDraftStart];
  dateRangeMonth = monthStart(isStart ? dateRangeDraftStart : dateRangeDraftEnd);
}
function chooseCalendarDay(dayMs){
  ensureDateRangeDraft();
  const base = dateRangeFocus === 'end' ? dateRangeDraftEnd : dateRangeDraftStart;
  const d = new Date(dayMs);
  const b = new Date(base);
  b.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
  if(dateRangeFocus === 'start'){
    dateRangeDraftStart = b.getTime();
    dateRangeFocus = 'end';
  } else {
    dateRangeDraftEnd = b.getTime();
    dateRangeFocus = 'start';
  }
  if(dateRangeDraftStart > dateRangeDraftEnd) [dateRangeDraftStart, dateRangeDraftEnd] = [dateRangeDraftEnd, dateRangeDraftStart];
}
function dateRangeCalendarHtml(){
  ensureDateRangeDraft();
  const month = new Date(dateRangeMonth || monthStart(dateRangeDraftStart));
  month.setDate(1); month.setHours(0, 0, 0, 0);
  const startDay = new Date(month); startDay.setDate(1 - month.getDay());
  const days = [];
  const today = dayStart(Number(snapshot?.timestamp || Date.now()));
  const selectedStart = dayStart(dateRangeDraftStart);
  const selectedEnd = dayStart(dateRangeDraftEnd);
  for(let i = 0; i < 42; i++){
    const d = new Date(startDay); d.setDate(startDay.getDate() + i); d.setHours(0, 0, 0, 0);
    const msValue = d.getTime();
    const muted = d.getMonth() !== month.getMonth();
    const selected = msValue === selectedStart || msValue === selectedEnd;
    const inRange = msValue > Math.min(selectedStart, selectedEnd) && msValue < Math.max(selectedStart, selectedEnd);
    days.push(`<button type="button" class="${muted ? 'muted' : ''} ${selected ? 'selected' : ''} ${inRange ? 'in-range' : ''} ${msValue === today ? 'today' : ''}" data-date-range-day="${msValue}">${d.getDate()}</button>`);
  }
  const monthTitle = `${month.getFullYear()}年${month.getMonth() + 1}月`;
  return `<div class="date-range-calendar"><div class="date-range-month"><button type="button" data-date-range-month="prev" aria-label="${TXT.previousMonth}">‹</button><b>${esc(monthTitle)}</b><button type="button" data-date-range-month="next" aria-label="${TXT.nextMonth}">›</button></div><div class="date-range-week"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="date-range-days">${days.join('')}</div></div>`;
}
function dateRangeFieldHtml(which, label, value){
  const active = dateRangeFocus === which ? 'active' : '';
  return `<label class="date-range-field ${active}" data-date-range-focus="${which}"><span>${label}</span><div><input type="date" data-date-range-date="${which}" value="${esc(dateInputValue(value))}" /><input type="time" data-date-range-time="${which}" value="${esc(timeInputValue(value))}" /></div></label>`;
}
function dateRangePopoverHtml(){
  ensureDateRangeDraft();
  const quick = [['today', TXT.today], ['1d', '1d'], ['7d', '7d'], ['14d', '14d'], ['30d', '30d']];
  return `<div class="date-range-popover" role="dialog" aria-label="${TXT.dateRange}"><div class="date-range-quick">${quick.map(([k, label]) => `<button type="button" data-date-range-quick="${k}" class="${k === 'today' ? 'active' : ''}">${label}</button>`).join('')}</div><div class="date-range-body"><div class="date-range-editor"><span class="date-range-support">${TXT.supportDateTime}</span>${dateRangeFieldHtml('start', TXT.startTime, dateRangeDraftStart)}${dateRangeFieldHtml('end', TXT.endTime, dateRangeDraftEnd)}<label class="date-range-follow"><input type="checkbox" data-date-range-follow="1" ${dateRangeFollowNow ? 'checked' : ''} /><span>${TXT.followNow}</span></label><div class="date-range-actions"><button type="button" class="ghost" data-date-range-cancel="1">${TXT.cancel}</button><button type="button" class="primary" data-date-range-confirm="1">${TXT.confirm}</button></div></div>${dateRangeCalendarHtml()}</div></div>`;
}
function rangeHtml(){
  rangeFilter = normalizeRangeFilter(rangeFilter);
  if(rangeFilter !== 'customTime'){
    const now = Number(snapshot?.timestamp || Date.now());
    const since = sinceForRange(snapshot || { timestamp: now }, rangeFilter);
    customDateStart = since || now - 86400000;
    customDateEnd = rangeFilter === 'today' ? now : now;
    dateRangeFollowNow = true;
    rangeFilter = 'customTime';
    localStorage.setItem('statsRange', rangeFilter);
    localStorage.setItem('customDateStart', String(customDateStart));
    localStorage.setItem('customDateEnd', String(customDateEnd));
    localStorage.setItem('dateRangeFollowNow', '1');
  }
  const r = normalizeCustomDateRange(snapshot || {});
  const summary = `${dateFullLabel(r.start)} - ${dateRangeFollowNow ? '现在' : dateFullLabel(r.end)}`;
  return `<div class="date-range-control ${dateRangeOpen ? 'open' : ''}" title="${TXT.dateRange}" aria-label="${TXT.dateRange}"><button type="button" class="date-range-trigger" data-date-range-toggle="1" aria-expanded="${dateRangeOpen ? 'true' : 'false'}"><span>${TXT.dateRange}</span><b>${esc(summary)}</b><i></i></button>${dateRangeOpen ? dateRangePopoverHtml() : ''}</div>`;
}
