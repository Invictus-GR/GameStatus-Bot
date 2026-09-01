import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createServerStatusAlertState,
  deserializeServerStatusAlertState,
  markServerStatusAlertDelivered,
  observeServerStatus,
  serializeServerStatusAlertState
} from '../src/serverStatusAlertState.js';

function observe(state, isOnline, checkedAt) {
  return observeServerStatus(state, { isOnline, checkedAt });
}

test('baselines an online server without creating an alert', () => {
  const result = observe(createServerStatusAlertState(), true, 1_000);

  assert.equal(result.confirmedStatus, 'online');
  assert.equal(result.transition, null);
  assert.deepEqual(result.state.pendingAlerts, []);
});

test('requires three consecutive offline checks before confirming downtime', () => {
  let state = observe(createServerStatusAlertState(), true, 1_000).state;

  let result = observe(state, false, 31_000);
  state = result.state;
  assert.equal(result.transition, 'pending-offline');
  assert.equal(state.consecutiveOfflineChecks, 1);
  assert.equal(state.pendingAlerts.length, 0);

  result = observe(state, false, 61_000);
  state = result.state;
  assert.equal(result.transition, 'pending-offline');
  assert.equal(state.consecutiveOfflineChecks, 2);
  assert.equal(state.pendingAlerts.length, 0);

  result = observe(state, false, 91_000);
  assert.equal(result.transition, 'down');
  assert.equal(result.confirmedStatus, 'offline');
  assert.equal(result.state.outageStartedAt, 31_000);
  assert.deepEqual(result.state.pendingAlerts, [{
    id: 'down:31000',
    type: 'down',
    detectedAt: 31_000
  }]);
});

test('cancels a pending outage when the server recovers before confirmation', () => {
  let state = observe(createServerStatusAlertState(), true, 1_000).state;
  state = observe(state, false, 31_000).state;
  state = observe(state, false, 61_000).state;
  const result = observe(state, true, 91_000);

  assert.equal(result.confirmedStatus, 'online');
  assert.equal(result.transition, null);
  assert.equal(result.state.consecutiveOfflineChecks, 0);
  assert.equal(result.state.firstOfflineDetectedAt, null);
  assert.deepEqual(result.state.pendingAlerts, []);
});

test('does not enqueue duplicate alerts while the outage continues', () => {
  let state = createServerStatusAlertState();
  state = observe(state, false, 1_000).state;
  state = observe(state, false, 31_000).state;
  state = observe(state, false, 61_000).state;
  const result = observe(state, false, 91_000);

  assert.equal(result.confirmedStatus, 'offline');
  assert.equal(result.transition, null);
  assert.equal(result.state.pendingAlerts.length, 1);
});

test('enqueues a recovery alert with the detected outage duration', () => {
  let state = createServerStatusAlertState();
  state = observe(state, false, 1_000).state;
  state = observe(state, false, 31_000).state;
  state = observe(state, false, 61_000).state;
  const result = observe(state, true, 181_000);

  assert.equal(result.transition, 'recovered');
  assert.equal(result.confirmedStatus, 'online');
  assert.equal(result.state.pendingAlerts.length, 2);
  assert.deepEqual(result.state.pendingAlerts[1], {
    id: 'recovered:181000',
    type: 'recovered',
    outageStartedAt: 1_000,
    recoveredAt: 181_000
  });
});

test('round-trips confirmation progress and queued alerts through JSON', () => {
  let state = observe(createServerStatusAlertState(), false, 1_000).state;
  state = observe(state, false, 31_000).state;
  const serialized = serializeServerStatusAlertState(state);
  const restored = deserializeServerStatusAlertState(
    JSON.parse(JSON.stringify(serialized))
  );
  const result = observe(restored, false, 61_000);

  assert.equal(result.transition, 'down');
  assert.equal(result.state.pendingAlerts[0].detectedAt, 1_000);
});

test('removes only the alert confirmed as delivered', () => {
  const state = {
    ...createServerStatusAlertState(),
    pendingAlerts: [
      { id: 'down:1000', type: 'down', detectedAt: 1_000 },
      {
        id: 'recovered:5000',
        type: 'recovered',
        outageStartedAt: 1_000,
        recoveredAt: 5_000
      }
    ]
  };
  const next = markServerStatusAlertDelivered(state, 'down:1000');

  assert.deepEqual(next.pendingAlerts.map(alert => alert.id), ['recovered:5000']);
});

test('ignores malformed persisted state instead of crashing startup', () => {
  const restored = deserializeServerStatusAlertState({
    confirmedStatus: 'broken',
    consecutiveOfflineChecks: -4,
    firstOfflineDetectedAt: 'yesterday',
    pendingAlerts: [null, { type: 'down' }]
  });

  assert.deepEqual(restored, createServerStatusAlertState());
});
