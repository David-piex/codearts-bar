function patchDateRangeChrome(){
  if(snapshot?.ok && patchDateRangeControlOnly()) return true;
  if(snapshot?.ok && patchAnalyticsFiltersOnly(snapshot)) return true;
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true });
  return Boolean(snapshot?.ok);
}
function patchDateRangeControlOnly(){
  if(typeof document?.querySelector !== 'function' || typeof document?.createElement !== 'function') return false;
  const control = document.querySelector('.date-range-control');
  if(!control) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = rangeHtml();
  const next = tmp.firstElementChild;
  if(!next) return false;
  control.replaceWith(next);
  try { lastCommittedHtml = ''; } catch {}
  return true;
}
function patchDateRangePopoverOnly(){
  if(!dateRangeOpen) return patchDateRangeControlOnly();
  if(typeof document?.querySelector !== 'function' || typeof document?.createElement !== 'function') return false;
  const current = document.querySelector('.date-range-control .date-range-popover');
  if(!current) return patchDateRangeControlOnly();
  const tmp = document.createElement('div');
  tmp.innerHTML = dateRangePopoverHtml();
  const next = tmp.firstElementChild;
  if(!next) return false;
  current.className = next.className;
  ['role', 'aria-label'].forEach((name) => {
    const value = next.getAttribute(name);
    if(value == null) current.removeAttribute(name);
    else current.setAttribute(name, value);
  });
  const nextCalendar = next.querySelector('.date-range-calendar');
  const currentCalendar = current.querySelector('.date-range-calendar');
  if(nextCalendar && currentCalendar) currentCalendar.replaceWith(nextCalendar);
  else if(!currentCalendar) current.innerHTML = next.innerHTML;
  syncDateRangeQuickChrome();
  syncDateRangeFieldChrome();
  try { lastCommittedHtml = ''; } catch {}
  return true;
}
function syncDateRangeQuickChrome(){
  if(typeof document?.querySelectorAll !== 'function') return;
  document.querySelectorAll('[data-date-range-quick]').forEach((button) => {
    const key = button?.dataset?.dateRangeQuick || '';
    button?.classList?.toggle?.('active', Boolean(key && dateRangeQuickActive(key)));
  });
}
function syncDateRangeInputChrome(){
  const active = document.activeElement;
  const pairs = [
    [`[data-date-range-date="start"]`, dateInputValue(dateRangeDraftStart)],
    [`[data-date-range-time="start"]`, timeInputValue(dateRangeDraftStart)],
    [`[data-date-range-date="end"]`, dateInputValue(dateRangeDraftEnd)],
    [`[data-date-range-time="end"]`, timeInputValue(dateRangeDraftEnd)],
  ];
  pairs.forEach(([selector, value]) => {
    const el = document.querySelector(selector);
    if(el && el !== active) el.value = value;
  });
}
function syncDateRangeFieldChrome(){
  if(typeof document?.querySelectorAll !== 'function') return;
  document.querySelectorAll('.date-range-field').forEach((field) => {
    const active = field?.dataset?.dateRangeFocus === dateRangeFocus;
    field?.classList?.toggle?.('active', Boolean(active));
  });
  syncDateRangeInputChrome();
}
function handleDateRangeDraftInput(target){
  const dateInput = target?.closest?.('[data-date-range-date], [data-date-range-time]');
  if(!dateInput) return false;
  const which = dateInput.dataset.dateRangeDate || dateInput.dataset.dateRangeTime;
  const part = dateInput.dataset.dateRangeDate ? 'date' : 'time';
  updateDateRangeDraft(which, part, dateInput.value);
  syncDateRangeFieldChrome();
  return true;
}
document.addEventListener('click', (e) => {
  const dateControl = e.target.closest('.date-range-control');
  if(dateRangeOpen && !dateControl){
    dateRangeOpen = false;
    patchDateRangeChrome();
    e.__dashboardHandled = true; return;
  }
  const dateToggle = e.target.closest('[data-date-range-toggle]');
  if(dateToggle){
    if(dateRangeOpen) dateRangeOpen = false;
    else openDateRangePopover();
    patchDateRangeChrome();
    e.__dashboardHandled = true; return;
  }
  const dateQuick = e.target.closest('[data-date-range-quick]');
  if(dateQuick){
    setDateRangeQuick(dateQuick.dataset.dateRangeQuick || 'today');
    patchDateRangePopoverOnly();
    e.__dashboardHandled = true; return;
  }
  const dateFocus = e.target.closest('[data-date-range-focus]');
  if(dateFocus && dateFocus.dataset.dateRangeFocus){
    dateRangeFocus = dateFocus.dataset.dateRangeFocus;
    dateRangeMonth = monthStart(dateRangeFocus === 'end' ? dateRangeDraftEnd : dateRangeDraftStart);
    if(e.target.closest('[data-date-range-date], [data-date-range-time]')){
      e.__dashboardHandled = true; return;
    }
    syncDateRangeFieldChrome();
    patchDateRangePopoverOnly();
    e.__dashboardHandled = true; return;
  }
  const dateMonth = e.target.closest('[data-date-range-month]');
  if(dateMonth){
    ensureDateRangeDraft();
    const d = new Date(dateRangeMonth || monthStart(dateRangeDraftStart));
    d.setMonth(d.getMonth() + (dateMonth.dataset.dateRangeMonth === 'next' ? 1 : -1));
    dateRangeMonth = monthStart(d.getTime());
    localStorage.setItem('dateRangeMonth', String(dateRangeMonth));
    patchDateRangePopoverOnly();
    e.__dashboardHandled = true; return;
  }
  const dateDay = e.target.closest('[data-date-range-day]');
  if(dateDay){
    chooseCalendarDay(Number(dateDay.dataset.dateRangeDay));
    patchDateRangePopoverOnly();
    e.__dashboardHandled = true; return;
  }
  const dateCancel = e.target.closest('[data-date-range-cancel]');
  if(dateCancel){
    dateRangeOpen = false;
    dateRangeDraftStart = 0;
    dateRangeDraftEnd = 0;
    patchDateRangeChrome();
    e.__dashboardHandled = true; return;
  }
  const dateConfirm = e.target.closest('[data-date-range-confirm]');
  if(dateConfirm){
    applyCustomDateInputs();
    dateRangeOpen = false;
    if(snapshot?.ok && workspaceMode === 'analytics' && patchAnalyticsSlotsForState(snapshot, { deferHeavy: true })) {}
    else if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true });
    e.__dashboardHandled = true; return;
  }
});
