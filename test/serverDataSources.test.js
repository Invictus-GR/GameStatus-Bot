import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFreshDataset,
  createReforgerModsClient,
  normalizeBattleMetricsServer,
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

test('BattleMetrics normalization validates status and counts', () => {
  assert.deepEqual(normalizeBattleMetricsServer({ data: { attributes: {
    status: 'online', players: 64, maxPlayers: 128
  } } }), {
    isOnline: true, players: 64, maxPlayers: 128, queue: null, __dataSource: 'BattleMetrics'
  });
  assert.throws(() => normalizeBattleMetricsServer({ data: { attributes: {
    status: 'online', players: 129, maxPlayers: 128
  } } }));
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

test('BattleMetrics is preferred by the secondary status client', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ data: { attributes: {
      status: 'online', players: 91, maxPlayers: 128
    } } }) };
  };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'TLC' });
  const result = await withFallback({
    operation: 'status',
    primary: async () => { throw new Error('ArmaHQ down'); },
    fallback: () => client.fetchStatus()
  });
  assert.equal(result.source, 'BattleMetrics');
  assert.equal(result.value.players, 91);
  assert.equal(result.value.queue, null);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /battlemetrics\.com\/servers\/40653024$/);
});

test('ReforgerMods is used if BattleMetrics status also fails without name discovery', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('battlemetrics.com')) {
      return { ok: false, status: 503 };
    }
    return { ok: true, json: async () => ({
      dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },
      server: { online: true, players: 10, maxPlayers: 128, queue: 3 }
    }) };
  };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'OLD TLC NAME' });
  const result = await withFallback({
    operation: 'status',
    primary: async () => { throw new Error('ArmaHQ down'); },
    fallback: () => client.fetchStatus()
  });
  assert.equal(result.source, 'ReforgerMods');
  assert.equal(result.value.queue, 3);
  assert.equal(calls.filter(url => url.includes('/servers?')).length, 0);
  assert.ok(calls.some(url => url.endsWith('/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300')));
});

test('client discovers exact server and caches its id when stable ID recovery is needed', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('battlemetrics.com')) {
      return { ok: false, status: 503 };
    }
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
  const client = createReforgerModsClient({ fetchImpl, serverName: 'TLC', serverId: null });
  await client.fetchStatus();
  await client.fetchStatus();
  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);
});


test('stable ReforgerMods ID survives a server rename', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('battlemetrics.com')) return { ok: false, status: 503 };
    if (String(url).includes('/servers?')) throw new Error('name discovery should not run');
    return { ok: true, json: async () => ({
      dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },
      server: { online: true, players: 7, maxPlayers: 128, queue: 1 }
    }) };
  };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'OLD TLC NAME' });
  const status = await client.fetchStatus();
  assert.equal(status.players, 7);
  assert.equal(calls.filter(url => url.includes('/servers?')).length, 0);
  assert.ok(calls.some(url => url.endsWith('/servers/1d8007f8-bc4d-45a6-86db-f1091aed4300')));
});


test('BattleMetrics exposes observed server name for identity synchronization', () => {
  const normalized = normalizeBattleMetricsServer({ data: { attributes: { name: 'EU | TLC | NEW NAME', status: 'online', players: 5, maxPlayers: 128 } } });
  assert.equal(normalized.serverName, 'EU | TLC | NEW NAME');
});

test('ReforgerMods discovery can proactively switch identity by observed name', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url)); if (String(url).includes('/servers?')) return { ok: true, json: async () => ({ dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 }, data: [{ id: 'new-room-id', name: 'EU | TLC | NEW NAME' }] }) }; throw new Error('unexpected request'); };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'EU | TLC | OLD NAME', serverId: 'old-room-id' });
  const discovered = await client.discoverServerId('EU | TLC | NEW NAME');
  assert.equal(discovered, 'new-room-id');
  assert.deepEqual(client.getIdentity(), { serverName: 'EU | TLC | NEW NAME', serverId: 'new-room-id' });
  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);
});

test('persisted identity can be restored into the ReforgerMods client', () => {
  const client = createReforgerModsClient({ fetchImpl: async () => { throw new Error('network should not be used'); }, serverName: 'DEFAULT NAME' });
  client.setIdentity({ serverName: 'RESTORED NAME', serverId: 'restored-id' });
  assert.deepEqual(client.getIdentity(), { serverName: 'RESTORED NAME', serverId: 'restored-id' });
});
