import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advancePendingRemovals,
  assessMassRemovalSnapshot,
  MOD_CHECK_INTERVAL_MS,
  MOD_REMOVAL_CONFIRMATIONS
} from '../src/modSnapshotGuard.js';

function snapshot(size, prefix = 'mod') {
  return new Map(
    Array.from({ length: size }, (_, index) => [
      `${prefix}-${index}`,
      { modId: `${prefix}-${index}` }
    ])
  );
}

test('accepts an ordinary small removal immediately', () => {
  const previous = snapshot(100);
  const current = snapshot(95);

  const result = assessMassRemovalSnapshot(previous, current);

  assert.equal(result.accept, true);
  assert.equal(result.confirmed, false);
  assert.equal(result.candidate, null);
});

test('quarantines the first suspicious mass-removal snapshot', () => {
  const previous = snapshot(100);
  const current = snapshot(60);

  const result = assessMassRemovalSnapshot(previous, current);

  assert.equal(result.accept, false);
  assert.equal(result.confirmations, 1);
  assert.equal(result.missingCount, 40);
  assert.ok(result.candidate);
});

test('accepts the same suspicious snapshot only after confirmation', () => {
  const previous = snapshot(100);
  const current = snapshot(60);
  const first = assessMassRemovalSnapshot(previous, current);
  const second = assessMassRemovalSnapshot(previous, current, first.candidate);

  assert.equal(second.accept, true);
  assert.equal(second.confirmed, true);
  assert.equal(second.candidate, null);
});

test('does not combine different partial snapshots into a confirmation', () => {
  const previous = snapshot(100);
  const first = assessMassRemovalSnapshot(previous, snapshot(60));
  const differentSnapshot = new Map([
    ...snapshot(59),
    ['replacement-mod', { modId: 'replacement-mod' }]
  ]);
  const second = assessMassRemovalSnapshot(
    previous,
    differentSnapshot,
    first.candidate
  );

  assert.equal(second.accept, false);
  assert.equal(second.confirmations, 1);
});

test('clears a quarantined candidate when the full list recovers', () => {
  const previous = snapshot(100);
  const suspicious = assessMassRemovalSnapshot(previous, snapshot(60));
  const recovered = assessMassRemovalSnapshot(
    previous,
    snapshot(100),
    suspicious.candidate
  );

  assert.equal(recovered.accept, true);
  assert.equal(recovered.confirmed, false);
  assert.equal(recovered.candidate, null);
  assert.equal(recovered.missingCount, 0);
});

test('requires four consecutive checks before confirming an ordinary removal', () => {
  const baseline = snapshot(100);
  const missingOne = snapshot(99);
  let previous = baseline;
  let pending = new Map();

  for (let check = 1; check <= MOD_REMOVAL_CONFIRMATIONS; check += 1) {
    const result = advancePendingRemovals(previous, missingOne, pending);
    pending = result.pendingRemovals;
    previous = missingOne;

    assert.equal(
      result.removedMods.length,
      check === MOD_REMOVAL_CONFIRMATIONS ? 1 : 0
    );
  }
});

test('keeps the worst-case post time within two minutes', () => {
  const worstCaseDetectionDelay = MOD_CHECK_INTERVAL_MS;
  const confirmationDelay =
    MOD_CHECK_INTERVAL_MS * (MOD_REMOVAL_CONFIRMATIONS - 1);

  assert.equal(worstCaseDetectionDelay + confirmationDelay, 2 * 60 * 1000);
});

test('counts the two mass-removal guard checks toward four confirmations', () => {
  const baseline = snapshot(100);
  const massRemoval = snapshot(60);
  let result = advancePendingRemovals(
    baseline,
    massRemoval,
    new Map(),
    { initialConfirmations: 2 }
  );

  assert.equal(result.removedMods.length, 0);
  assert.equal(result.pendingRemovals.get('mod-60').confirmations, 2);

  result = advancePendingRemovals(
    massRemoval,
    massRemoval,
    result.pendingRemovals
  );
  assert.equal(result.removedMods.length, 0);

  result = advancePendingRemovals(
    massRemoval,
    massRemoval,
    result.pendingRemovals
  );
  assert.equal(result.removedMods.length, 40);
});

test('cancels a pending removal as soon as the mod reappears', () => {
  const baseline = snapshot(100);
  const missingOne = snapshot(99);
  const first = advancePendingRemovals(baseline, missingOne, new Map());
  const recovered = advancePendingRemovals(
    missingOne,
    baseline,
    first.pendingRemovals
  );

  assert.equal(recovered.removedMods.length, 0);
  assert.equal(recovered.pendingRemovals.size, 0);
  assert.equal(recovered.recoveredPendingRemovals.has('mod-99'), true);
});
