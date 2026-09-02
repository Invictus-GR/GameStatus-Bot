import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRollingModAlertDescription,
  countRollingModChanges,
  createRollingModEventRows,
  groupRollingModEvents
} from '../src/rollingModAlerts.js';

test('creates stable event rows for every mod in one detected change', () => {
  const rows = createRollingModEventRows({
    type: 'removed',
    detectedAt: '2026-09-02T13:39:00.000Z',
    mods: [
      { modId: 'bravo', name: ' Bravo ' },
      { modId: 'alpha', name: 'Alpha' },
      { modId: 'alpha', name: 'Alpha duplicate' }
    ]
  });

  assert.deepEqual(rows, [
    {
      eventKey: 'removed:2026-09-02T13:39:00.000Z:bravo',
      type: 'removed',
      modId: 'bravo',
      name: 'Bravo',
      detectedAt: '2026-09-02T13:39:00.000Z'
    },
    {
      eventKey: 'removed:2026-09-02T13:39:00.000Z:alpha',
      type: 'removed',
      modId: 'alpha',
      name: 'Alpha duplicate',
      detectedAt: '2026-09-02T13:39:00.000Z'
    }
  ]);
});

test('groups simultaneous mods and keeps every later repeat', () => {
  const events = groupRollingModEvents([
    {
      change_type: 'added',
      mod_id: 'alpha',
      mod_name: 'Alpha',
      detected_at: '2026-09-02T13:00:00.000Z'
    },
    {
      change_type: 'added',
      mod_id: 'bravo',
      mod_name: 'Bravo',
      detected_at: '2026-09-02T13:00:00.000Z'
    },
    {
      change_type: 'added',
      mod_id: 'alpha',
      mod_name: 'Alpha',
      detected_at: '2026-09-02T13:39:00.000Z'
    }
  ]);

  assert.equal(events.length, 2);
  assert.deepEqual(events[0].mods.map(mod => mod.name), ['Alpha', 'Bravo']);
  assert.deepEqual(events[1].mods.map(mod => mod.name), ['Alpha']);
  assert.equal(countRollingModChanges(events), 3);
});

test('renders each event time and marks only the newest update', () => {
  const events = groupRollingModEvents([
    {
      type: 'removed',
      modId: 'alpha',
      name: 'Alpha',
      detectedAt: '2026-09-02T13:00:00.000Z'
    },
    {
      type: 'removed',
      modId: 'bravo',
      name: 'Bravo',
      detectedAt: '2026-09-02T13:39:00.000Z'
    }
  ]);
  const description = buildRollingModAlertDescription(events);

  assert.match(description, /<t:1788354000:t>/);
  assert.match(description, /<t:1788356340:t>\*\* — \*\*LATEST\*\*/);
  assert.equal((description.match(/LATEST/g) ?? []).length, 1);
  assert.ok(description.indexOf('Alpha') < description.indexOf('Bravo'));
});

test('hides the oldest updates when the Discord description limit is reached', () => {
  const events = groupRollingModEvents(
    Array.from({ length: 10 }, (_, index) => ({
      type: 'added',
      modId: `mod-${index}`,
      name: `Long Mod Name ${index} ${'x'.repeat(30)}`,
      detectedAt: new Date(Date.UTC(2026, 8, 2, 13, index)).toISOString()
    }))
  );
  const description = buildRollingModAlertDescription(events, 220);

  assert.ok(description.length <= 220);
  assert.match(description, /earlier update\(s\) hidden/);
  assert.match(description, /LATEST/);
  assert.match(description, /Long Mod Name 9/);
});
