import test from 'node:test';
import assert from 'node:assert/strict';

import { assessMassRemovalSnapshot } from '../src/modSnapshotGuard.js';

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
