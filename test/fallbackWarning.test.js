import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitedWarning } from '../src/fallbackWarning.js';

test('rate-limited warning logs immediately and suppresses repeats inside interval', () => {
  let now = 1000;
  const logs = [];
  const warn = createRateLimitedWarning({
    intervalMs: 300000,
    now: () => now,
    log: (...args) => logs.push(args)
  });

  assert.equal(warn('armahq-status', 'first'), true);
  assert.equal(warn('armahq-status', 'second'), false);
  assert.deepEqual(logs, [['first']]);
});

test('rate-limited warning logs again after interval', () => {
  let now = 1000;
  const logs = [];
  const warn = createRateLimitedWarning({
    intervalMs: 300000,
    now: () => now,
    log: (...args) => logs.push(args)
  });

  warn('battlemetrics-status', 'first');
  now += 299999;
  assert.equal(warn('battlemetrics-status', 'too soon'), false);
  now += 1;
  assert.equal(warn('battlemetrics-status', 'after interval'), true);
  assert.deepEqual(logs, [['first'], ['after interval']]);
});

test('rate limits are independent per warning key', () => {
  const logs = [];
  const warn = createRateLimitedWarning({
    intervalMs: 300000,
    now: () => 1000,
    log: (...args) => logs.push(args)
  });

  assert.equal(warn('armahq-status', 'status'), true);
  assert.equal(warn('armahq-mods', 'mods'), true);
  assert.equal(warn('armahq-status', 'duplicate'), false);
  assert.deepEqual(logs, [['status'], ['mods']]);
});

test('rate limiter validates configuration and keys', () => {
  assert.throws(() => createRateLimitedWarning({ intervalMs: -1 }), RangeError);
  const warn = createRateLimitedWarning({ now: () => 1000, log: () => {} });
  assert.throws(() => warn('', 'message'), TypeError);
});
