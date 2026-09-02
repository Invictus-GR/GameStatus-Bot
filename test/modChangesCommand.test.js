import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createModChangesCommandEmbeds,
  handleModChangesCommand,
  MOD_CHANGES_OWNER_ID,
  queryLatestRecordedModHistory
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

test('shows a neutral empty state when no history exists', () => {
  const embeds = createModChangesCommandEmbeds({
    reportDate: '2026-09-02',
    activeMods: 135,
    added: [],
    removed: [],
    footerText: 'TLC Command'
  }).map(embed => embed.toJSON());

  assert.equal(embeds[0].description, '*No mod additions recorded.*');
  assert.equal(embeds[1].description, '*No mod removals recorded.*');
  assert.doesNotMatch(JSON.stringify(embeds), /UK reporting/i);
  assert.doesNotMatch(JSON.stringify(embeds), /today/i);
});

test('loads the latest recorded mod day from persistent storage', async () => {
  const queries = [];
  const db = {
    query: async (sql, params = []) => {
      queries.push([sql, params]);

      if (sql.includes('MAX(report_date)')) {
        return { rows: [{ report_date: '2026-09-01' }] };
      }

      return {
        rows: [
          {
            change_type: 'added',
            mod_id: 'alpha',
            mod_name: 'Alpha',
            detected_at: '2026-09-01T20:00:00.000Z'
          },
          {
            change_type: 'removed',
            mod_id: 'bravo',
            mod_name: 'Bravo',
            detected_at: '2026-09-01T21:00:00.000Z'
          }
        ]
      };
    }
  };

  const history = await queryLatestRecordedModHistory(db);

  assert.equal(history.reportDate, '2026-09-01');
  assert.equal(history.added[0].mods[0].name, 'Alpha');
  assert.equal(history.removed[0].mods[0].name, 'Bravo');
  assert.equal(queries.length, 2);
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

test('falls back to the latest persisted history after a UK day rollover', async () => {
  const calls = [];
  const interaction = {
    user: { id: MOD_CHANGES_OWNER_ID },
    deferReply: async payload => calls.push(['defer', payload]),
    editReply: async payload => calls.push(['edit', payload])
  };

  await handleModChangesCommand(interaction, {
    getCurrentRollingModHistory: async () => ({
      reportDate: '2026-09-03',
      activeMods: null,
      added: [],
      removed: []
    }),
    getLatestRecordedModHistory: async () => sampleHistory,
    fetchServerMods: async () => Array.from({ length: 135 }, () => ({})),
    footerText: 'TLC Command'
  });

  const embeds = calls[1][1].embeds.map(embed => embed.toJSON());
  assert.match(embeds[0].description, /Alpha/);
  assert.match(embeds[1].description, /Bravo/);
  assert.equal(embeds[0].fields[0].value, '135');
});
