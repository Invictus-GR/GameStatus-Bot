import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deserializeModWatcherState,
  serializeModWatcherState
} from '../src/modWatcherState.js';
import { flushRetryQueue } from '../src/modAlertRetry.js';
import { advancePendingRemovals } from '../src/modSnapshotGuard.js';

function mod(modId, name = modId) {
  return { modId, name, version: '1.0.0' };
}

test('round-trips the complete mod watcher state', () => {
  const alpha = mod('alpha', 'Alpha');
  const bravo = mod('bravo', 'Bravo');
  const serialized = serializeModWatcherState({
    previousModSnapshot: new Map([
      [alpha.modId, alpha],
      [bravo.modId, bravo]
    ]),
    pendingRemovedMods: new Map([
      [bravo.modId, { mod: bravo, confirmations: 3 }]
    ]),
    massRemovalCandidate: { signature: 'bravo', confirmations: 1 },
    pendingModAlerts: new Map([
      ['removed:bravo', {
        type: 'removed',
        mods: [bravo],
        activeMods: 1
      }]
    ])
  });
  const restored = deserializeModWatcherState(
    JSON.parse(JSON.stringify(serialized))
  );

  assert.equal(restored.previousModSnapshot.size, 2);
  assert.equal(restored.previousModSnapshot.get('alpha').name, 'Alpha');
  assert.equal(restored.pendingRemovedMods.get('bravo').confirmations, 3);
  assert.deepEqual(restored.massRemovalCandidate, {
    signature: 'bravo',
    confirmations: 1
  });
  assert.equal(restored.pendingModAlerts.size, 1);
  assert.equal(restored.pendingModAlerts.get('removed:bravo').activeMods, 1);
});

test('serializes maps deterministically regardless of insertion order', () => {
  const alpha = mod('alpha');
  const bravo = mod('bravo');
  const emptyState = {
    pendingRemovedMods: new Map(),
    massRemovalCandidate: null,
    pendingModAlerts: new Map()
  };
  const first = serializeModWatcherState({
    ...emptyState,
    previousModSnapshot: new Map([
      ['bravo', bravo],
      ['alpha', alpha]
    ])
  });
  const second = serializeModWatcherState({
    ...emptyState,
    previousModSnapshot: new Map([
      ['alpha', alpha],
      ['bravo', bravo]
    ])
  });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('ignores malformed persisted entries instead of crashing startup', () => {
  const restored = deserializeModWatcherState({
    previousSnapshot: [null, { modId: '', name: 'Broken' }, mod('valid')],
    pendingRemovals: [
      { mod: mod('pending'), confirmations: 2 },
      { mod: mod('bad-count'), confirmations: 0 }
    ],
    massRemovalCandidate: { signature: '', confirmations: 1 },
    pendingAlerts: [
      { type: 'removed', mods: [mod('queued')], activeMods: 10 },
      { type: 'unknown', mods: [mod('invalid')], activeMods: 10 }
    ]
  });

  assert.equal(restored.previousModSnapshot.size, 1);
  assert.equal(restored.pendingRemovedMods.size, 1);
  assert.equal(restored.massRemovalCandidate, null);
  assert.equal(restored.pendingModAlerts.size, 1);
});

test('returns safe empty state for missing database data', () => {
  const restored = deserializeModWatcherState(null);

  assert.equal(restored.previousModSnapshot, null);
  assert.equal(restored.pendingRemovedMods.size, 0);
  assert.equal(restored.massRemovalCandidate, null);
  assert.equal(restored.pendingModAlerts.size, 0);
});

test('continues a pending removal confirmation after restart', () => {
  const alpha = mod('alpha');
  const bravo = mod('bravo');
  const serialized = serializeModWatcherState({
    previousModSnapshot: new Map([[alpha.modId, alpha]]),
    pendingRemovedMods: new Map([
      [bravo.modId, { mod: bravo, confirmations: 3 }]
    ]),
    massRemovalCandidate: null,
    pendingModAlerts: new Map()
  });
  const restored = deserializeModWatcherState(serialized);
  const result = advancePendingRemovals(
    restored.previousModSnapshot,
    restored.previousModSnapshot,
    restored.pendingRemovedMods
  );

  assert.equal(result.removedMods.length, 1);
  assert.equal(result.removedMods[0].modId, 'bravo');
  assert.equal(result.pendingRemovals.size, 0);
});

test('restores a queued alert so delivery can resume after restart', async () => {
  const queuedMod = mod('queued');
  const serialized = serializeModWatcherState({
    previousModSnapshot: new Map([[queuedMod.modId, queuedMod]]),
    pendingRemovedMods: new Map(),
    massRemovalCandidate: null,
    pendingModAlerts: new Map([
      ['added:queued', {
        type: 'added',
        mods: [queuedMod],
        activeMods: 1
      }]
    ])
  });
  const restored = deserializeModWatcherState(serialized);
  let delivered = 0;

  await flushRetryQueue(restored.pendingModAlerts, async () => {
    delivered += 1;
  });

  assert.equal(delivered, 1);
  assert.equal(restored.pendingModAlerts.size, 0);
});
