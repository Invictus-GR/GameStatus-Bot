import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCapacityBar,
  formatCapacityField,
  STATUS_BAR_SEGMENTS
} from '../src/statusDisplay.js';

test('renders an empty capacity bar', () => {
  const result = createCapacityBar(0, 25);

  assert.equal(result.bar, '░'.repeat(STATUS_BAR_SEGMENTS));
  assert.equal(result.percentage, 0);
});

test('renders a full capacity bar', () => {
  const result = createCapacityBar(128, 128);

  assert.equal(result.bar, '█'.repeat(STATUS_BAR_SEGMENTS));
  assert.equal(result.percentage, 100);
});

test('clamps values outside the supported range', () => {
  assert.equal(createCapacityBar(-5, 128).value, 0);
  assert.equal(createCapacityBar(200, 128).value, 128);
});

test('formats a Discord-safe field with value and percentage', () => {
  const value = formatCapacityField(64, 128);

  assert.match(value, /64\/128/);
  assert.match(value, /50%/);
  assert.match(value, /██████████░░░░░░░░░░/);
});
