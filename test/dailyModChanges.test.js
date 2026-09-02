import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyModChangeFields,
  groupDailyModChanges,
  MOD_CHANGE_FIELD_VALUE_LIMIT,
  MOD_CHANGE_MAX_FIELDS_PER_TYPE
} from '../src/dailyModChanges.js';

test('groups, deduplicates and sorts daily mod changes', () => {
  const grouped = groupDailyModChanges([
    { change_type: 'removed', mod_id: 'bravo', mod_name: 'Bravo' },
    { change_type: 'added', mod_id: 'zulu', mod_name: 'Zulu' },
    { change_type: 'added', mod_id: 'alpha', mod_name: 'Alpha' },
    { change_type: 'added', mod_id: 'alpha', mod_name: 'Alpha duplicate' },
    { change_type: 'invalid', mod_id: 'ignored', mod_name: 'Ignored' }
  ]);

  assert.deepEqual(grouped, {
    added: [
      { modId: 'alpha', name: 'Alpha duplicate' },
      { modId: 'zulu', name: 'Zulu' }
    ],
    removed: [{ modId: 'bravo', name: 'Bravo' }]
  });
});

test('builds readable added and removed mod fields', () => {
  const fields = buildDailyModChangeFields({
    added: [
      { modId: 'zulu', name: 'Zulu' },
      { modId: 'alpha', name: 'Alpha' }
    ],
    removed: [{ modId: 'bravo', name: 'Bravo' }]
  });

  assert.equal(fields.length, 2);
  assert.equal(fields[0].name, '➕ ADDED MODS (2)');
  assert.equal(fields[0].value, '• **Alpha**\n• **Zulu**');
  assert.equal(fields[1].name, '🗑️ REMOVED MODS (1)');
  assert.equal(fields[1].value, '• **Bravo**');
  assert.equal(fields.every(field => field.inline === false), true);
});

test('omits detail fields when there were no mod changes', () => {
  assert.deepEqual(buildDailyModChangeFields(), []);
});

test('keeps large mod lists inside Discord field limits', () => {
  const added = Array.from({ length: 200 }, (_, index) => ({
    modId: `mod-${index}`,
    name: `Very Long Mod Name ${String(index).padStart(3, '0')} ${'x'.repeat(30)}`
  }));
  const fields = buildDailyModChangeFields({ added, removed: [] });

  assert.equal(fields.length, MOD_CHANGE_MAX_FIELDS_PER_TYPE);
  assert.equal(
    fields.every(field => field.value.length <= MOD_CHANGE_FIELD_VALUE_LIMIT),
    true
  );
  assert.match(fields.at(-1).value, /…and \d+ more/);
});
