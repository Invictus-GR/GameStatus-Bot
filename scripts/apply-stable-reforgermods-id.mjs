import fs from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, found ${count}`);
  return text.replace(oldText, newText);
}

const stableId = '1d8007f8-bc4d-45a6-86db-f1091aed4300';
const sourcePath = 'src/serverDataSources.js';
let source = fs.readFileSync(sourcePath, 'utf8');

if (!source.includes("const DEFAULT_REFORGERMODS_SERVER_ID")) {
  source = replaceOnce(
    source,
    "const DEFAULT_BATTLEMETRICS_SERVER_ID = '40653024';\n",
    "const DEFAULT_BATTLEMETRICS_SERVER_ID = '40653024';\nconst DEFAULT_REFORGERMODS_SERVER_ID = '1d8007f8-bc4d-45a6-86db-f1091aed4300';\n",
    'stable ID constant'
  );
}

source = replaceOnce(
  source,
  "  serverName,\n  serverAddress = '85.234.84.65:2000',\n  baseUrl",
  "  serverName,\n  serverId = DEFAULT_REFORGERMODS_SERVER_ID,\n  baseUrl",
  'client parameters'
);

source = replaceOnce(
  source,
  "  let cachedServerId = null;",
  "  let cachedServerId = typeof serverId === 'string' && serverId.trim() ? serverId.trim() : null;",
  'initial cached server ID'
);

const oldDiscovery = `    const servers = Array.isArray(payload?.data) ? payload.data : [];
    const normalizeAddress = value => String(value || '').trim().toLowerCase();
    const targetAddress = normalizeAddress(serverAddress);
    const byAddress = servers.find(server => {
      const candidates = [
        server?.address,
        server?.endpoint,
        server?.ipPort,
        server?.host && server?.port ? \`${'${server.host}:${server.port}'}\` : null,
        server?.ip && server?.port ? \`${'${server.ip}:${server.port}'}\` : null
      ];
      return candidates.some(value => normalizeAddress(value) === targetAddress);
    });
    const exact = byAddress ?? servers.find(server => server?.name === serverName);
    const id = exact?.id ?? exact?.roomId ?? exact?.room_id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new DataSourceError('ReforgerMods', \`TLC server was not found by address ${'${serverAddress}'} or current name\`);
    }`;

const newDiscovery = `    const servers = Array.isArray(payload?.data) ? payload.data : [];
    const exact = servers.find(server => server?.name === serverName);
    const id = exact?.id ?? exact?.roomId ?? exact?.room_id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new DataSourceError('ReforgerMods', 'TLC server was not found by current name during recovery discovery');
    }`;

source = replaceOnce(source, oldDiscovery, newDiscovery, 'recovery discovery');
fs.writeFileSync(sourcePath, source);

const testPath = 'test/serverDataSources.test.js';
let tests = fs.readFileSync(testPath, 'utf8');

const oldFallbackTest = `test('ReforgerMods is used if BattleMetrics status also fails', async () => {
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
      server: { online: true, players: 10, maxPlayers: 128, queue: 3 }
    }) };
  };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'TLC' });
  const result = await withFallback({
    operation: 'status',
    primary: async () => { throw new Error('ArmaHQ down'); },
    fallback: () => client.fetchStatus()
  });
  assert.equal(result.source, 'ReforgerMods');
  assert.equal(result.value.queue, 3);
});`;

const newFallbackTest = `test('ReforgerMods is used if BattleMetrics status also fails without name discovery', async () => {
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
  assert.ok(calls.some(url => url.endsWith('/servers/${stableId}')));
});`;

tests = replaceOnce(tests, oldFallbackTest, newFallbackTest, 'ReforgerMods fallback test');

const oldDiscoveryTestStart = "test('client discovers exact server and caches its id', async () => {";
const newDiscoveryTestStart = "test('client discovers exact server and caches its id when stable ID recovery is needed', async () => {";
tests = replaceOnce(tests, oldDiscoveryTestStart, newDiscoveryTestStart, 'discovery test title');

tests = replaceOnce(
  tests,
  "  const client = createReforgerModsClient({ fetchImpl, serverName: 'TLC' });\n  await client.fetchStatus();\n  await client.fetchStatus();\n  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);\n});\n\n\ntest('client prefers stable server address over changing name', async () => {",
  "  const client = createReforgerModsClient({ fetchImpl, serverName: 'TLC', serverId: null });\n  await client.fetchStatus();\n  await client.fetchStatus();\n  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);\n});\n\n\ntest('stable ReforgerMods ID survives a server rename', async () => {",
  'discovery test client and stable ID test title'
);

tests = replaceOnce(
  tests,
  "    if (String(url).includes('/servers?')) return { ok: true, json: async () => ({\n      dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },\n      data: [{ id: 'room-stable', name: 'RENAMED TLC SERVER', address: '85.234.84.65:2000' }]\n    }) };",
  "    if (String(url).includes('/servers?')) throw new Error('name discovery should not run');",
  'stable ID no-discovery mock'
);

tests = replaceOnce(
  tests,
  "  const client = createReforgerModsClient({ fetchImpl, serverName: 'OLD TLC NAME', serverAddress: '85.234.84.65:2000' });\n  const status = await client.fetchStatus();\n  assert.equal(status.players, 7);\n  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);",
  `  const client = createReforgerModsClient({ fetchImpl, serverName: 'OLD TLC NAME' });\n  const status = await client.fetchStatus();\n  assert.equal(status.players, 7);\n  assert.equal(calls.filter(url => url.includes('/servers?')).length, 0);\n  assert.ok(calls.some(url => url.endsWith('/servers/${stableId}')));`,
  'stable ID assertions'
);

fs.writeFileSync(testPath, tests);
