'use strict';
function createSingleFlight() {
  const pending = new Map();
  function run(key, factory) {
    if (pending.has(key)) return pending.get(key).promise;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => factory(controller.signal)).finally(() => { if (pending.get(key)?.promise === promise) pending.delete(key); });
    pending.set(key, { promise, controller, startedAt: Date.now() });
    return promise;
  }
  function cancel(key, reason = 'cancelled') { const entry=pending.get(key); if(!entry)return false; entry.controller.abort(reason); pending.delete(key); return true; }
  function cancelAll(reason='cancelled') { for(const key of [...pending.keys()])cancel(key,reason); }
  function stats(){return [...pending.entries()].map(([key,x])=>({key,ageMs:Date.now()-x.startedAt}));}
  return { run, cancel, cancelAll, stats };
}
module.exports={createSingleFlight};
