'use strict';

const assert = require('node:assert/strict');
const { createLatestTaskQueue } = require('../src/main/latest-task-queue');

(async () => {
  const seen = [];
  let releaseFirst;
  const firstStarted = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = createLatestTaskQueue(async (value, isSuperseded) => {
    seen.push(`start:${value}`);
    if (value === 'first') {
      await firstStarted;
      if (isSuperseded()) return 'discarded';
    }
    seen.push(`commit:${value}`);
    return value;
  });

  const first = queue.enqueue('first');
  const second = queue.enqueue('second');
  const third = queue.enqueue('third');
  releaseFirst();
  const result = await Promise.all([first, second, third]);

  assert.deepEqual(seen, ['start:first', 'start:third', 'commit:third']);
  assert.deepEqual(result, ['discarded', 'third', 'third']);
  assert.equal(queue.busy(), false);
  console.log('ok - latest task queue preserves in-flight caller results and coalesces pending refreshes');
})().catch((error) => { console.error(error); process.exit(1); });
