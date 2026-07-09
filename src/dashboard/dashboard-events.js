function patchSessionsOrRender(opts = {}){
  if(snapshot?.ok && workspaceMode === 'sessions' && patchSessionView(snapshot, opts)) return true;
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: true });
  return false;
}
function patchSessionModalOrRender(){
  const hasModalSlot = typeof document.querySelector === 'function' ? Boolean(document.querySelector('#sessionModalSlot')) : false;
  if(snapshot?.ok && workspaceMode === 'sessions' && hasModalSlot && patchSessionModal()) return true;
  if(snapshot?.ok) render(snapshot, { windowLayout: false, instantChart: true, partial: false });
  return false;
}
const DASHBOARD_EVENT_HANDLED = Symbol('dashboard-event-handled');
async function runDashboardClickHandler(handler, event){
  try {
    const handled = await handler(event);
    if(handled || event.__dashboardHandled){ event.__dashboardHandled = true; return true; }
  } catch (error) {
    if(error === DASHBOARD_EVENT_HANDLED){ event.__dashboardHandled = true; return true; }
    throw error;
  }
  return false;
}
document.addEventListener('click', async (e) => {
  if(e.__dashboardHandled) return;
  const handlers = [handleDashboardChromeClick, handleDashboardSessionClick, handleDashboardAnalyticsClick];
  for(const handler of handlers){
    if(await runDashboardClickHandler(handler, e)) return;
  }
});
