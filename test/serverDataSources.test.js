import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFreshDataset,
  createReforgerModsClient,
  normalizeReforgerModsMods,
  normalizeReforgerModsServer,
  withFallback
} from '../src/serverDataSources.js';

test('freshness gate rejects warming, stale and old snapshots', () => {
  assert.throws(() => assertFreshDataset({ warming: true, stale: false, snapshotAgeSeconds: 1 }));
  assert.throws(() => assertFreshDataset({ warming: false, stale: true, snapshotAgeSeconds: 1 }));
  assert.throws(() => assertFreshDataset({ warming: false, stale: false, snapshotAgeSeconds: 121 }));
  assert.doesNotThrow(() => assertFreshDataset({ warming: false, stale: false, snapshotAgeSeconds: 120 }));
});

test('server normalization validates counts', () => {
  assert.deepEqual(normalizeReforgerModsServer({ online: true, players: 128, maxPlayers: 128, queue: 7 }), {
    isOnline: true, players: 128, maxPlayers: 128, queue: 7
  });
  assert.throws(() => normalizeReforgerModsServer({ online: true, players: 129, maxPlayers: 128, queue: 0 }));
});

test('mod normalization deduplicates by mod id', () => {
  const mods = normalizeReforgerModsMods({ mods: [
    { modId: 'A', name: 'Zulu', version: '1' },
    { modId: 'A', name: 'Zulu duplicate', version: '2' },
    { modId: 'B', name: 'Alpha', version: '3' }
  ] });
  assert.deepEqual(mods.map(mod => mod.modId), ['B', 'A']);
});

test('fallback is used only when primary throws', async () => {
  const result = await withFallback({
    operation: 'status',
    primary: async () => { throw new Error('primary down'); },
    fallback: async () => ({ isOnline: true, players: 100, maxPlayers: 128, queue: 2 })
  });
  assert.equal(result.source, 'ReforgerMods');
  assert.equal(result.value.isOnline, true);
});

test('client discovers exact server and caches its id', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('/servers?')) {
      return { ok: true, json: async () => ({
        dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },
        data: [{ id: 'room-1', name: 'TLC' }]
      }) };
    }
    return { ok: true, json: async () => ({
      dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },
      server: { online: true, players: 10, maxPlayers: 128, queue: 0 }
    }) };
  };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'TLC' });
  await client.fetchStatus();
  await client.fetchStatus();
  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);
});
