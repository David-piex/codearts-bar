'use strict';

// Coalesce requests that have not started yet while preserving the result of the
// task already in flight. A caller must never receive a result produced for a
// different payload just because another refresh arrived while it was waiting.
function createLatestTaskQueue(run) {
  if (typeof run !== 'function') throw new TypeError('createLatestTaskQueue requires a function');
  let pending = null;
  let inFlight = null;

  async function drain() {
    while (pending !== null) {
      const job = pending;
      pending = null;
      try {
        const result = await run(job.payload, () => pending !== null);
        for (const waiter of job.waiters) waiter.resolve(result);
      } catch (error) {
        for (const waiter of job.waiters) waiter.reject(error);
      }
    }
  }

  function ensureDrain() {
    if (inFlight) return;
    inFlight = drain().finally(() => {
      inFlight = null;
      if (pending !== null) ensureDrain();
    });
  }

  function enqueue(payload) {
    const promise = new Promise((resolve, reject) => {
      if (pending) {
        pending.payload = payload;
        pending.waiters.push({ resolve, reject });
      } else {
        pending = { payload, waiters: [{ resolve, reject }] };
      }
    });
    ensureDrain();
    return promise;
  }

  return Object.freeze({ enqueue, busy: () => Boolean(inFlight || pending !== null) });
}

module.exports = { createLatestTaskQueue };
