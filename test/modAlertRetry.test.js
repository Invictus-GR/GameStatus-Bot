import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deliverOrQueue,
  flushRetryQueue,
  withRetry
} from '../src/modAlertRetry.js';

test('returns immediately when the first send succeeds', async () => {
  let attempts = 0;

  const result = await withRetry(async () => {
    attempts += 1;
    return 'sent';
  });

  assert.equal(result, 'sent');
  assert.equal(attempts, 1);
});

test('retries transient failures and then succeeds', async () => {
  let attempts = 0;
  const delays = [];

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary Discord failure');
      return 'sent';
    },
    {
      sleep: async delayMs => delays.push(delayMs)
    }
  );

  assert.equal(result, 'sent');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2000, 5000]);
});

test('throws the final error after all retry attempts fail', async () => {
  let attempts = 0;

  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new Error('Discord unavailable');
      },
      { sleep: async () => {} }
    ),
    /Discord unavailable/
  );

  assert.equal(attempts, 3);
});

test('queues a failed alert and removes it after a later successful retry', async () => {
  const queue = new Map();
  const alert = { type: 'removed', mods: [{ modId: 'abc' }] };
  const failed = await deliverOrQueue(
    queue,
    'removed:abc',
    alert,
    async () => {
      throw new Error('Discord unavailable');
    }
  );

  assert.equal(failed.delivered, false);
  assert.equal(queue.size, 1);

  const retried = await flushRetryQueue(queue, async () => {});

  assert.equal(retried.length, 1);
  assert.equal(retried[0].delivered, true);
  assert.equal(queue.size, 0);
});

test('keeps a queued alert when the later retry still fails', async () => {
  const queue = new Map([
    ['added:xyz', { type: 'added', mods: [{ modId: 'xyz' }] }]
  ]);

  const retried = await flushRetryQueue(queue, async () => {
    throw new Error('still unavailable');
  });

  assert.equal(retried[0].delivered, false);
  assert.equal(queue.size, 1);
});
