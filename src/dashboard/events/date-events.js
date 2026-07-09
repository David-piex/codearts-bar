function patchDateRangeChrome(){
  if(snapshot?.ok && patchAnalyticsFiltersOnly(snapshot)) return true;
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, deferHeavy: true, partial: true });
  return Boolean(snapshot?.ok);
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
    patchDateRangeChrome();
    e.__dashboardHandled = true; return;
  }
  const dateFocus = e.target.closest('[data-date-range-focus]');
  if(dateFocus && dateFocus.dataset.dateRangeFocus){
    dateRangeFocus = dateFocus.dataset.dateRangeFocus;
    dateRangeMonth = monthStart(dateRangeFocus === 'end' ? dateRangeDraftEnd : dateRangeDraftStart);
    patchDateRangeChrome();
    e.__dashboardHandled = true; return;
  }
  const dateMonth = e.target.closest('[data-date-range-month]');
  if(dateMonth){
    ensureDateRangeDraft();
    const d = new Date(dateRangeMonth || monthStart(dateRangeDraftStart));
    d.setMonth(d.getMonth() + (dateMonth.dataset.dateRangeMonth === 'next' ? 1 : -1));
    dateRangeMonth = monthStart(d.getTime());
    localStorage.setItem('dateRangeMonth', String(dateRangeMonth));
    patchDateRangeChrome();
    e.__dashboardHandled = true; return;
  }
  const dateDay = e.target.closest('[data-date-range-day]');
  if(dateDay){
    chooseCalendarDay(Number(dateDay.dataset.dateRangeDay));
    patchDateRangeChrome();
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
