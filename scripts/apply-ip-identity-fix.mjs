import fs from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, found ${count}`);
  return text.replace(oldText, newText);
}

const sourcePath = 'src/serverDataSources.js';
let source = fs.readFileSync(sourcePath, 'utf8');
source = replaceOnce(source,
  "  serverName,\n  baseUrl",
  "  serverName,\n  serverAddress = '85.234.84.65:2000',\n  baseUrl",
  'client signature');
source = replaceOnce(source,
`    const exact = servers.find(server => server?.name === serverName);
    const id = exact?.id ?? exact?.roomId ?? exact?.room_id;
    if (typeof id !== 'string' || id.length === 0) throw new DataSourceError('ReforgerMods', 'TLC server was not found by exact name');`,
`    const normalizeAddress = value => String(value || '').trim().toLowerCase();
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
    }`,
  'server discovery');
fs.writeFileSync(sourcePath, source);

const testPath = 'test/serverDataSources.test.js';
let tests = fs.readFileSync(testPath, 'utf8');
if (!tests.includes("client prefers stable server address over changing name")) {
  tests += `\n\ntest('client prefers stable server address over changing name', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('battlemetrics.com')) return { ok: false, status: 503 };
    if (String(url).includes('/servers?')) return { ok: true, json: async () => ({
      dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },
      data: [{ id: 'room-stable', name: 'RENAMED TLC SERVER', address: '85.234.84.65:2000' }]
    }) };
    return { ok: true, json: async () => ({
      dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 },
      server: { online: true, players: 7, maxPlayers: 128, queue: 1 }
    }) };
  };
  const client = createReforgerModsClient({ fetchImpl, serverName: 'OLD TLC NAME', serverAddress: '85.234.84.65:2000' });
  const status = await client.fetchStatus();
  assert.equal(status.players, 7);
  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);
});\n`;
  fs.writeFileSync(testPath, tests);
}
