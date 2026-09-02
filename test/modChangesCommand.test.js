import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createModChangesCommandEmbeds,
  handleModChangesCommand,
  MOD_CHANGES_OWNER_ID
} from '../src/modChangesCommand.js';

const sampleHistory = {
  reportDate: '2026-09-02',
  activeMods: 135,
  added: [
    {
      type: 'added',
      detectedAt: '2026-09-02T13:00:00.000Z',
      mods: [{ modId: 'alpha', name: 'Alpha' }]
    }
  ],
  removed: [
    {
      type: 'removed',
      detectedAt: '2026-09-02T13:39:00.000Z',
      mods: [{ modId: 'bravo', name: 'Bravo' }]
    }
  ]
};

test('builds two public snapshot embeds with no everyone mention', () => {
  const embeds = createModChangesCommandEmbeds({
    ...sampleHistory,
    footerText: 'TLC Command'
  }).map(embed => embed.toJSON());

  assert.equal(embeds.length, 2);
  assert.equal(embeds[0].title, '➕ CURRENT MOD ADDITIONS');
  assert.equal(embeds[1].title, '🗑️ CURRENT MOD REMOVALS');
  assert.match(embeds[0].description, /Alpha/);
  assert.match(embeds[1].description, /Bravo/);
  assert.doesNotMatch(JSON.stringify(embeds), /@everyone/);
});

test('shows a clear empty state when the reporting period has no changes', () => {
  const embeds = createModChangesCommandEmbeds({
    reportDate: '2026-09-02',
    activeMods: 135,
    added: [],
    removed: [],
    footerText: 'TLC Command'
  }).map(embed => embed.toJSON());

  assert.match(embeds[0].description, /No confirmed mod additions/);
  assert.match(embeds[1].description, /No confirmed mod removals/);
});

test('rejects every user except Invictus without posting publicly', async () => {
  const calls = [];
  const interaction = {
    user: { id: 'someone-else' },
    reply: async payload => calls.push(payload)
  };

  await handleModChangesCommand(interaction, {
    getCurrentRollingModHistory: async () => sampleHistory,
    fetchServerMods: async () => [],
    footerText: 'TLC Command'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].flags !== undefined, true);
});

test('posts the current history publicly for Invictus', async () => {
  const calls = [];
  const interaction = {
    user: { id: MOD_CHANGES_OWNER_ID },
    deferReply: async payload => calls.push(['defer', payload]),
    editReply: async payload => calls.push(['edit', payload])
  };

  await handleModChangesCommand(interaction, {
    getCurrentRollingModHistory: async () => sampleHistory,
    fetchServerMods: async () => [],
    footerText: 'TLC Command'
  });

  assert.deepEqual(calls[0], ['defer', undefined]);
  assert.equal(calls[1][0], 'edit');
  assert.equal(calls[1][1].embeds.length, 2);
});
