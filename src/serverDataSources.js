const DEFAULT_BASE_URL = 'https://api.reforgermods.net/v2';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_SNAPSHOT_AGE_SECONDS = 120;

export class DataSourceError extends Error {
  constructor(source, message, cause) {
    super(`${source}: ${message}`);
    this.name = 'DataSourceError';
    this.source = source;
    this.cause = cause;
  }
}

function asFiniteInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function assertFreshDataset(dataset, maxSnapshotAgeSeconds = DEFAULT_MAX_SNAPSHOT_AGE_SECONDS) {
  if (!dataset || typeof dataset !== 'object') {
    throw new DataSourceError('ReforgerMods', 'dataset metadata is missing');
  }
  if (dataset.warming === true) {
    throw new DataSourceError('ReforgerMods', 'dataset is still warming');
  }
  if (dataset.stale === true) {
    throw new DataSourceError('ReforgerMods', 'dataset is stale');
  }
  const age = Number(dataset.snapshotAgeSeconds);
  if (!Number.isFinite(age) || age < 0) {
    throw new DataSourceError('ReforgerMods', 'snapshot age is invalid');
  }
  if (age > maxSnapshotAgeSeconds) {
    throw new DataSourceError('ReforgerMods', `snapshot is too old (${age}s)`);
  }
}

export function normalizeReforgerModsServer(server) {
  if (!server || typeof server !== 'object') {
    throw new DataSourceError('ReforgerMods', 'server object is missing');
  }

  const isOnline = server.online ?? server.isOnline ?? server.status === 'online';
  if (typeof isOnline !== 'boolean') {
    throw new DataSourceError('ReforgerMods', 'online status is invalid');
  }

  const maxPlayers = asFiniteInteger(server.maxPlayers ?? server.playerLimit ?? server.maxPlayerCount, 128);
  const players = isOnline
    ? asFiniteInteger(server.players ?? server.playerCount ?? server.currentPlayers)
    : 0;
  const queue = isOnline
    ? asFiniteInteger(server.queue ?? server.queueSize ?? server.queuedPlayers, 0)
    : 0;

  if (players === null || maxPlayers === null || players > maxPlayers) {
    throw new DataSourceError('ReforgerMods', 'player counts are invalid');
  }

  return { isOnline, players, maxPlayers, queue };
}

function normalizeMod(raw) {
  const modId = raw?.modId ?? raw?.id ?? raw?.workshopId ?? raw?.workshop?.id;
  const name = raw?.name ?? raw?.modName ?? raw?.workshop?.name;
  const version = raw?.version ?? raw?.modVersion ?? raw?.reportedVersion ?? raw?.workshop?.version ?? 'Unknown';

  if (typeof modId !== 'string' || modId.trim() === '' || typeof name !== 'string' || name.trim() === '') {
    return null;
  }

  return {
    modId: modId.trim(),
    name: name.trim(),
    version: String(version || 'Unknown').trim() || 'Unknown'
  };
}

export function normalizeReforgerModsMods(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : payload?.mods ?? payload?.data ?? payload?.server?.mods ?? payload?.server?.reportedMods ?? [];

  if (!Array.isArray(candidates)) {
    throw new DataSourceError('ReforgerMods', 'mod list is invalid');
  }

  const normalized = candidates.map(normalizeMod).filter(Boolean);
  return [...new Map(normalized.map(mod => [mod.modId, mod])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function createReforgerModsClient({
  fetchImpl,
  serverName,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxSnapshotAgeSeconds = DEFAULT_MAX_SNAPSHOT_AGE_SECONDS
}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof serverName !== 'string' || serverName.trim() === '') throw new TypeError('serverName is required');

  let cachedServerId = null;

  async function requestJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          'User-Agent': 'TLC-Command/1.0',
          'X-API-Client': 'TLC-Command/1.0',
          'X-ReforgerMods-Client': 'TLC-Command',
          'X-ReforgerMods-Client-Version': '1.0'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new DataSourceError('ReforgerMods', `HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof DataSourceError) throw error;
      if (error?.name === 'AbortError') {
        throw new DataSourceError('ReforgerMods', `request timed out after ${timeoutMs}ms`, error);
      }
      throw new DataSourceError('ReforgerMods', error?.message || 'request failed', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function discoverServerId() {
    const url = new URL(`${baseUrl}/servers`);
    url.searchParams.set('search', serverName);
    url.searchParams.set('includeOffline', 'true');
    url.searchParams.set('perPage', '100');
    const payload = await requestJson(url);
    assertFreshDataset(payload?.dataset, maxSnapshotAgeSeconds);

    const servers = Array.isArray(payload?.data) ? payload.data : [];
    const exact = servers.find(server => server?.name === serverName);
    if (!exact || typeof exact.id !== 'string' || exact.id.length === 0) {
      throw new DataSourceError('ReforgerMods', 'TLC server was not found by exact name');
    }
    cachedServerId = exact.id;
    return cachedServerId;
  }

  async function getServerId() {
    return cachedServerId || discoverServerId();
  }

  async function getServerPayload({ retryDiscovery = true } = {}) {
    const serverId = await getServerId();
    try {
      const payload = await requestJson(`${baseUrl}/servers/${encodeURIComponent(serverId)}`);
      assertFreshDataset(payload?.dataset, maxSnapshotAgeSeconds);
      return payload;
    } catch (error) {
      if (!retryDiscovery) throw error;
      cachedServerId = null;
      await discoverServerId();
      return getServerPayload({ retryDiscovery: false });
    }
  }

  async function fetchStatus() {
    const payload = await getServerPayload();
    return normalizeReforgerModsServer(payload?.server);
  }

  async function fetchMods() {
    const serverId = await getServerId();
    try {
      const payload = await requestJson(`${baseUrl}/servers/${encodeURIComponent(serverId)}/mods?sizes=false`);
      if (payload?.dataset) assertFreshDataset(payload.dataset, maxSnapshotAgeSeconds);
      const mods = normalizeReforgerModsMods(payload);
      if (mods.length === 0) throw new DataSourceError('ReforgerMods', 'server mod list is empty');
      return mods;
    } catch (error) {
      cachedServerId = null;
      throw error;
    }
  }

  return { fetchStatus, fetchMods, discoverServerId };
}

export async function withFallback({ primary, fallback, operation }) {
  try {
    const value = await primary();
    return { value, source: 'ArmaHQ' };
  } catch (primaryError) {
    console.warn(`ArmaHQ ${operation} failed; trying ReforgerMods:`, primaryError?.message || primaryError);
    try {
      const value = await fallback();
      return { value, source: 'ReforgerMods', primaryError };
    } catch (fallbackError) {
      throw new AggregateError(
        [primaryError, fallbackError],
        `Both server data sources failed during ${operation}`
      );
    }
  }
}
