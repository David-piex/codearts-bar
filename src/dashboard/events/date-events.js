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
  syncDateRangeErrorChrome();
}
function syncDateRangeErrorChrome(){
  try {
    const error = dateRangeError || '';
    const node = document.querySelector('[data-date-range-error]');
    if(node){
      node.textContent = error;
      node.hidden = !error;
    }
    const confirm = document.querySelector('[data-date-range-confirm]');
    if(confirm) confirm.disabled = Boolean(error);
  } catch {}
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
async function applyDateRangeAndPatchView(opts = {}){
  if(applyCustomDateInputs() === false){
    syncDateRangeErrorChrome();
    return false;
  }
  resetIncrementalRenderLimits('all');
  resetRequestPaging();
  resetSessionPaging();
  if(snapshot?.ok && workspaceMode === 'analytics'){
    setPagedTableLoading?.('requests', true, 0);
    try {
      await refreshRequestPageCache(0, { force: true });
      await ensureRequestPageInBoundsAfterLoad?.();
      scrollPagedTableToTop?.('requests');
    } catch {
      setPagedTableLoading?.('requests', false, 0);
    } finally {
      clearPagedTableLoading?.('requests');
    }
    if(patchAnalyticsSlotsForState(snapshot, { deferHeavy: true, chartDelayMs: 40, ...opts })) return true;
    render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true });
    return true;
  }
  if(snapshot?.ok && workspaceMode === 'sessions'){
    setPagedTableLoading?.('sessions', true, 0);
    try {
      const canDbPage = typeof canUseDbSessionPage === 'function' && canUseDbSessionPage();
      if(canDbPage) await refreshSessionPageCache(0, { force: true });
      if(canDbPage) await ensureSessionPageInBoundsAfterLoad?.();
      scrollPagedTableToTop?.('sessions');
    } catch {
      setPagedTableLoading?.('sessions', false, 0);
    } finally {
      clearPagedTableLoading?.('sessions');
    }
    if(patchSessionView(snapshot, { table: true, toolbar: false, inspector: true, pageChange: true })) return true;
    render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true });
    return true;
  }
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true });
  return Boolean(snapshot?.ok);
}
document.addEventListener('click', async (e) => {
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
    dateRangeError = '';
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
    dateRangeError = dateRangeDraftValidation();
    if(dateRangeError){
      syncDateRangeErrorChrome();
      e.__dashboardHandled = true; return;
    }
    dateRangeOpen = false;
    await applyDateRangeAndPatchView();
    e.__dashboardHandled = true; return;
  }
});
