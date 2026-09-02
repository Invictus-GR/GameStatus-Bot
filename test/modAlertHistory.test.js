import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHistoricalModId,
  mergeHistoricalModChanges,
  parseHistoricalModAlertEmbed
} from '../src/modAlertHistory.js';

test('parses every mod name from an added-mod alert', () => {
  const changes = parseHistoricalModAlertEmbed({
    title: '➕ TLC MODS ADDED',
    description:
      'The following mods have been added to the server:\n\n' +
      '• **Alpha Framework**\n' +
      '• **Zulu Weapons**'
  }, 'added', '2026-09-01T20:30:00.000Z');

  assert.deepEqual(changes, [
    {
      type: 'added',
      modId: createHistoricalModId('Alpha Framework'),
      name: 'Alpha Framework',
      detectedAt: '2026-09-01T20:30:00.000Z'
    },
    {
      type: 'added',
      modId: createHistoricalModId('Zulu Weapons'),
      name: 'Zulu Weapons',
      detectedAt: '2026-09-01T20:30:00.000Z'
    }
  ]);
});

test('parses the singular removed-mod alert title', () => {
  const changes = parseHistoricalModAlertEmbed({
    title: '🗑️ TLC MOD REMOVED',
    description:
      'The following mod has been removed from the server:\n\n' +
      '• **Legacy Gear**'
  }, 'removed', new Date('2026-09-01T21:00:00.000Z'));

  assert.equal(changes.length, 1);
  assert.equal(changes[0].name, 'Legacy Gear');
  assert.equal(changes[0].type, 'removed');
});

test('ignores unrelated embeds and invalid timestamps', () => {
  assert.deepEqual(
    parseHistoricalModAlertEmbed({
      title: 'Unrelated alert',
      description: '• **Not a mod alert**'
    }, 'added', '2026-09-01T20:30:00.000Z'),
    []
  );
  assert.deepEqual(
    parseHistoricalModAlertEmbed({
      title: '➕ TLC MOD ADDED',
      description: '• **Alpha**'
    }, 'added', 'not-a-date'),
    []
  );
});

test('deduplicates repeated history messages and keeps the earliest timestamp', () => {
  const modId = createHistoricalModId('Alpha');
  const merged = mergeHistoricalModChanges([
    {
      type: 'added',
      modId,
      name: 'Alpha',
      detectedAt: '2026-09-01T21:00:00.000Z'
    },
    {
      type: 'added',
      modId,
      name: 'Alpha',
      detectedAt: '2026-09-01T20:00:00.000Z'
    }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].detectedAt, '2026-09-01T20:00:00.000Z');
});
