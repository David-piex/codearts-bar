'use strict';

// Coalesce bursty filesystem/UI refreshes and always finish with the newest request.
function createLatestTaskQueue(run) {
  if (typeof run !== 'function') throw new TypeError('createLatestTaskQueue requires a function');
  let pending = null;
  let inFlight = null;

  async function drain() {
    let result;
    while (pending !== null) {
      const payload = pending;
      pending = null;
      result = await run(payload, () => pending !== null);
    }
    return result;
  }

  function enqueue(payload) {
    pending = payload;
    if (inFlight) return inFlight;
    inFlight = drain().finally(() => {
      inFlight = null;
      if (pending !== null) enqueue(pending);
    });
    return inFlight;
  }

  return Object.freeze({ enqueue, busy: () => Boolean(inFlight || pending !== null) });
}

module.exports = { createLatestTaskQueue };
