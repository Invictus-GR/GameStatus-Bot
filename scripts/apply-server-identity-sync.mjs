import fs from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 anchor, found ${count}`);
  return text.replace(oldText, newText);
}

const dsPath = 'src/serverDataSources.js';
let ds = fs.readFileSync(dsPath, 'utf8');

ds = replaceOnce(ds,
  "  return {\n    isOnline,\n    players,\n    maxPlayers,\n    queue: 0,\n    __dataSource: 'BattleMetrics'\n  };",
  "  const serverName = typeof attributes.name === 'string' && attributes.name.trim() ? attributes.name.trim() : null;\n  return {\n    isOnline,\n    players,\n    maxPlayers,\n    queue: 0,\n    ...(serverName ? { serverName } : {}),\n    __dataSource: 'BattleMetrics'\n  };", 'BattleMetrics server name');

ds = replaceOnce(ds,
  "  return { isOnline, players, maxPlayers, queue };",
  "  const serverName = typeof server.name === 'string' && server.name.trim() ? server.name.trim() : null;\n  return { isOnline, players, maxPlayers, queue, ...(serverName ? { serverName } : {}) };", 'ReforgerMods server name');

ds = replaceOnce(ds,
  "  if (typeof serverName !== 'string' || serverName.trim() === '') throw new TypeError('serverName is required');\n  let cachedServerId = typeof serverId === 'string' && serverId.trim() ? serverId.trim() : null;",
  "  if (typeof serverName !== 'string' || serverName.trim() === '') throw new TypeError('serverName is required');\n  let currentServerName = serverName.trim();\n  let cachedServerId = typeof serverId === 'string' && serverId.trim() ? serverId.trim() : null;", 'mutable client identity');

ds = replaceOnce(ds,
  "  async function discoverServerId() {\n    const url = new URL(`${baseUrl}/servers`);\n    url.searchParams.set('search', serverName);",
  "  async function discoverServerId(serverNameOverride = currentServerName) {\n    const requestedName = String(serverNameOverride || '').trim();\n    if (!requestedName) throw new DataSourceError('ReforgerMods', 'server name is required for discovery');\n    const url = new URL(`${baseUrl}/servers`);\n    url.searchParams.set('search', requestedName);", 'discovery accepts observed name');

ds = replaceOnce(ds,
  "    const exact = servers.find(server => server?.name === serverName);\n    const id = exact?.id ?? exact?.roomId ?? exact?.room_id;\n    if (typeof id !== 'string' || id.length === 0) {\n      throw new DataSourceError('ReforgerMods', 'TLC server was not found by current name during recovery discovery');\n    }\n    cachedServerId = id;\n    return id;",
  "    const exact = servers.find(server => server?.name === requestedName);\n    const id = exact?.id ?? exact?.roomId ?? exact?.room_id;\n    if (typeof id !== 'string' || id.length === 0) {\n      throw new DataSourceError('ReforgerMods', `TLC server was not found by observed name: ${requestedName}`);\n    }\n    currentServerName = requestedName;\n    cachedServerId = id;\n    return id;", 'discovery updates identity');

ds = replaceOnce(ds,
  "  async function getServerId() { return cachedServerId || discoverServerId(); }",
  "  async function getServerId() { return cachedServerId || discoverServerId(); }\n\n  function setIdentity({ serverName: nextServerName, serverId: nextServerId } = {}) {\n    if (typeof nextServerName === 'string' && nextServerName.trim()) currentServerName = nextServerName.trim();\n    if (typeof nextServerId === 'string' && nextServerId.trim()) cachedServerId = nextServerId.trim();\n    return { serverName: currentServerName, serverId: cachedServerId };\n  }\n\n  function getIdentity() { return { serverName: currentServerName, serverId: cachedServerId }; }", 'identity getters setters');

ds = replaceOnce(ds, "  return { fetchStatus, fetchMods, discoverServerId };", "  return { fetchStatus, fetchMods, discoverServerId, setIdentity, getIdentity };", 'client exports identity methods');
fs.writeFileSync(dsPath, ds);

const botPath = 'src/bot.js';
let bot = fs.readFileSync(botPath, 'utf8');
bot = replaceOnce(bot, "    await pool.query(`\n      CREATE TABLE IF NOT EXISTS mod_watcher_state (", "    await pool.query(`\n      CREATE TABLE IF NOT EXISTS server_identity_state (\n        id SMALLINT PRIMARY KEY CHECK (id = 1),\n        server_name TEXT NOT NULL,\n        reforgermods_server_id TEXT NOT NULL,\n        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n      );\n    `);\n\n    await pool.query(`\n      CREATE TABLE IF NOT EXISTS mod_watcher_state (", 'server identity table');
bot = replaceOnce(bot, "const reforgerModsClient = createReforgerModsClient({\n  fetchImpl: fetch,\n  serverName: SERVER_NAME\n});", "const reforgerModsClient = createReforgerModsClient({\n  fetchImpl: fetch,\n  serverName: SERVER_NAME\n});\nlet currentServerName = SERVER_NAME;", 'runtime server name');

const identityHelpers = `async function persistServerIdentity(serverName, reforgerModsServerId) {
  try {
    await pool.query(\`INSERT INTO server_identity_state (id, server_name, reforgermods_server_id, updated_at) VALUES (1, $1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET server_name = EXCLUDED.server_name, reforgermods_server_id = EXCLUDED.reforgermods_server_id, updated_at = NOW();\`, [serverName, reforgerModsServerId]);
    return true;
  } catch (error) { console.error('❌ Failed to persist server identity:', error); return false; }
}

async function restoreServerIdentity() {
  try {
    const result = await pool.query(\`SELECT server_name, reforgermods_server_id FROM server_identity_state WHERE id = 1\`);
    if (result.rows.length === 0) {
      const identity = reforgerModsClient.getIdentity();
      await persistServerIdentity(currentServerName, identity.serverId);
      console.log('Server identity state initialized from configured defaults.');
      return false;
    }
    const row = result.rows[0];
    currentServerName = row.server_name;
    reforgerModsClient.setIdentity({ serverName: row.server_name, serverId: row.reforgermods_server_id });
    console.log(\`Restored server identity: \${currentServerName} / \${row.reforgermods_server_id}\`);
    return true;
  } catch (error) { console.error('❌ Failed to restore server identity:', error); return false; }
}

async function syncObservedServerIdentity(observedName, source) {
  const nextName = typeof observedName === 'string' ? observedName.trim() : '';
  if (!nextName || nextName === currentServerName) return false;
  try {
    const serverId = await reforgerModsClient.discoverServerId(nextName);
    currentServerName = nextName;
    await persistServerIdentity(nextName, serverId);
    console.log(\`Server identity synchronized from \${source}: \${nextName} / \${serverId}\`);
    return true;
  } catch (error) {
    console.warn(\`Server rename observed from \${source} but ReforgerMods identity sync failed:\`, error?.message || error);
    return false;
  }
}

function decodeBasicHtmlEntities(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function extractArmaHQServerName(html) {
  const candidates = [];
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogTitle?.[1]) candidates.push(ogTitle[1]);
  const h1 = html.match(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/i); if (h1?.[1]) candidates.push(h1[1].replace(/<[^>]+>/g, ' '));
  const title = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i); if (title?.[1]) candidates.push(title[1]);
  for (const candidate of candidates) {
    const cleaned = decodeBasicHtmlEntities(candidate).replace(/\\s+/g, ' ').replace(/\\s*[|–—-]\\s*ArmaHQ.*$/i, '').trim();
    if (/\\bTLC\\b|THE LAST COALITION/i.test(cleaned)) return cleaned;
  }
  return null;
}

async function requestArmaHQPage() {`;
bot = replaceOnce(bot, "async function requestArmaHQPage() {", identityHelpers, 'identity persistence and ArmaHQ name extraction');
bot = replaceOnce(bot, "function parseServerPage(html) {\n  const text = html", "function parseServerPage(html) {\n  const serverName = extractArmaHQServerName(html);\n  const text = html", 'parse ArmaHQ name');
bot = replaceOnce(bot, "      maxPlayers: 128,\n      queue: 0\n    };", "      maxPlayers: 128,\n      queue: 0,\n      serverName\n    };", 'offline ArmaHQ name');
bot = replaceOnce(bot, "    maxPlayers: Number(playersMatch[2]),\n    queue: queueMatch ? Number(queueMatch[1]) : 0\n  };", "    maxPlayers: Number(playersMatch[2]),\n    queue: queueMatch ? Number(queueMatch[1]) : 0,\n    serverName\n  };", 'online ArmaHQ name');
bot = replaceOnce(bot, ".setTitle(SERVER_NAME)\n    .setFooter({ text: FOOTER_TEXT })", ".setTitle(currentServerName)\n    .setFooter({ text: FOOTER_TEXT })", 'dynamic status title');
bot = replaceOnce(bot, "      serverData = result.value;\n      currentStatusDataSource = result.source;\n      if (result.source === 'ArmaHQ') {", "      serverData = result.value;\n      currentStatusDataSource = result.source;\n      if (serverData?.serverName) await syncObservedServerIdentity(serverData.serverName, result.source);\n      if (result.source === 'ArmaHQ') {", 'proactive identity sync on status');
bot = replaceOnce(bot, "  await initializeDatabase();\n  await pruneServerMetricSamples();", "  await initializeDatabase();\n  await restoreServerIdentity();\n  await pruneServerMetricSamples();", 'restore identity on startup');
fs.writeFileSync(botPath, bot);

const testPath = 'test/serverDataSources.test.js';
let tests = fs.readFileSync(testPath, 'utf8');
tests += `\n\ntest('BattleMetrics exposes observed server name for identity synchronization', () => {\n  const normalized = normalizeBattleMetricsServer({ data: { attributes: { name: 'EU | TLC | NEW NAME', status: 'online', players: 5, maxPlayers: 128 } } });\n  assert.equal(normalized.serverName, 'EU | TLC | NEW NAME');\n});\n\ntest('ReforgerMods discovery can proactively switch identity by observed name', async () => {\n  const calls = [];\n  const fetchImpl = async url => { calls.push(String(url)); if (String(url).includes('/servers?')) return { ok: true, json: async () => ({ dataset: { warming: false, stale: false, snapshotAgeSeconds: 5 }, data: [{ id: 'new-room-id', name: 'EU | TLC | NEW NAME' }] }) }; throw new Error('unexpected request'); };\n  const client = createReforgerModsClient({ fetchImpl, serverName: 'EU | TLC | OLD NAME', serverId: 'old-room-id' });\n  const discovered = await client.discoverServerId('EU | TLC | NEW NAME');\n  assert.equal(discovered, 'new-room-id');\n  assert.deepEqual(client.getIdentity(), { serverName: 'EU | TLC | NEW NAME', serverId: 'new-room-id' });\n  assert.equal(calls.filter(url => url.includes('/servers?')).length, 1);\n});\n\ntest('persisted identity can be restored into the ReforgerMods client', () => {\n  const client = createReforgerModsClient({ fetchImpl: async () => { throw new Error('network should not be used'); }, serverName: 'DEFAULT NAME' });\n  client.setIdentity({ serverName: 'RESTORED NAME', serverId: 'restored-id' });\n  assert.deepEqual(client.getIdentity(), { serverName: 'RESTORED NAME', serverId: 'restored-id' });\n});\n`;
fs.writeFileSync(testPath, tests);
