import { fallbackWarning } from './fallbackWarning.js';

const DEFAULT_BASE_URL = 'https://api.reforgermods.net/v2';
const DEFAULT_BATTLEMETRICS_BASE_URL = 'https://api.battlemetrics.com/servers';
const DEFAULT_BATTLEMETRICS_SERVER_ID = '40653024';
const DEFAULT_REFORGERMODS_SERVER_ID = '1d8007f8-bc4d-45a6-86db-f1091aed4300';
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
  if (!dataset || typeof dataset !== 'object') throw new DataSourceError('ReforgerMods', 'dataset metadata is missing');
  if (dataset.warming === true) throw new DataSourceError('ReforgerMods', 'dataset is still warming');
  if (dataset.stale === true) throw new DataSourceError('ReforgerMods', 'dataset is stale');
  const age = Number(dataset.snapshotAgeSeconds);
  if (!Number.isFinite(age) || age < 0) throw new DataSourceError('ReforgerMods', 'snapshot age is invalid');
  if (age > maxSnapshotAgeSeconds) throw new DataSourceError('ReforgerMods', `snapshot is too old (${age}s)`);
}

export function normalizeReforgerModsServer(server) {
  if (!server || typeof server !== 'object') throw new DataSourceError('ReforgerMods', 'server object is missing');
  let isOnline;
  if (typeof server.online === 'boolean') isOnline = server.online;
  else if (typeof server.isOnline === 'boolean') isOnline = server.isOnline;
  else if (typeof server.status === 'string') isOnline = server.status.toLowerCase() === 'online';
  else throw new DataSourceError('ReforgerMods', 'online status is invalid');

  const maxPlayers = asFiniteInteger(server.maxPlayers ?? server.playerLimit ?? server.maxPlayerCount, 128);
  const players = isOnline ? asFiniteInteger(server.players ?? server.playerCount ?? server.currentPlayers) : 0;
  const queue = isOnline ? asFiniteInteger(server.queue ?? server.queueSize ?? server.queuedPlayers, 0) : 0;
  if (players === null || maxPlayers === null || maxPlayers === 0 || players > maxPlayers) {
    throw new DataSourceError('ReforgerMods', 'player counts are invalid');
  }
  const serverName = typeof server.name === 'string' && server.name.trim() ? server.name.trim() : null;
  return { isOnline, players, maxPlayers, queue, ...(serverName ? { serverName } : {}) };
}

export function normalizeBattleMetricsServer(payload) {
  const attributes = payload?.data?.attributes;
  if (!attributes || typeof attributes !== 'object') {
    throw new DataSourceError('BattleMetrics', 'server attributes are missing');
  }

  const status = String(attributes.status || '').toLowerCase();
  if (!status) throw new DataSourceError('BattleMetrics', 'server status is missing');

  const isOnline = status === 'online';
  const maxPlayers = asFiniteInteger(attributes.maxPlayers, 128);
  const players = isOnline ? asFiniteInteger(attributes.players, null) : 0;

  if (maxPlayers === null || maxPlayers === 0 || players === null || players > maxPlayers) {
    throw new DataSourceError('BattleMetrics', 'player counts are invalid');
  }

  const serverName = typeof attributes.name === 'string' && attributes.name.trim() ? attributes.name.trim() : null;
  return {
    isOnline,
    players,
    maxPlayers,
    queue: null,
    ...(serverName ? { serverName } : {}),
    __dataSource: 'BattleMetrics'
  };
}

function normalizeMod(raw) {
  const modId = raw?.modId ?? raw?.id ?? raw?.workshopId ?? raw?.workshop?.id;
  const name = raw?.name ?? raw?.modName ?? raw?.workshop?.name;
  const version = raw?.version ?? raw?.modVersion ?? raw?.reportedVersion ?? raw?.workshop?.version ?? 'Unknown';
  if (typeof modId !== 'string' || modId.trim() === '' || typeof name !== 'string' || name.trim() === '') return null;
  return { modId: modId.trim(), name: name.trim(), version: String(version || 'Unknown').trim() || 'Unknown' };
}

export function normalizeReforgerModsMods(payload) {
  const candidates = Array.isArray(payload) ? payload : payload?.mods ?? payload?.data ?? payload?.server?.mods ?? payload?.server?.reportedMods ?? [];
  if (!Array.isArray(candidates)) throw new DataSourceError('ReforgerMods', 'mod list is invalid');
  const normalized = candidates.map(normalizeMod).filter(Boolean);
  return [...new Map(normalized.map(mod => [mod.modId, mod])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function createReforgerModsClient({
  fetchImpl,
  serverName,
  serverId = DEFAULT_REFORGERMODS_SERVER_ID,
  baseUrl = DEFAULT_BASE_URL,
  battleMetricsBaseUrl = DEFAULT_BATTLEMETRICS_BASE_URL,
  battleMetricsServerId = DEFAULT_BATTLEMETRICS_SERVER_ID,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxSnapshotAgeSeconds = DEFAULT_MAX_SNAPSHOT_AGE_SECONDS
}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof serverName !== 'string' || serverName.trim() === '') throw new TypeError('serverName is required');
  let currentServerName = serverName.trim();
  let cachedServerId = typeof serverId === 'string' && serverId.trim() ? serverId.trim() : null;

  async function requestJson(url, source = 'ReforgerMods') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { 'User-Agent': 'TLC-Command/1.0', 'X-API-Client': 'TLC-Command/1.0' }, signal: controller.signal });
      if (!response.ok) throw new DataSourceError(source, `HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof DataSourceError) throw error;
      if (error?.name === 'AbortError') throw new DataSourceError(source, `request timed out after ${timeoutMs}ms`, error);
      throw new DataSourceError(source, error?.message || 'request failed', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function discoverServerId(serverNameOverride = currentServerName) {
    const requestedName = String(serverNameOverride || '').trim();
    if (!requestedName) throw new DataSourceError('ReforgerMods', 'server name is required for discovery');
    const url = new URL(`${baseUrl}/servers`);
    url.searchParams.set('search', requestedName);
    url.searchParams.set('includeOffline', 'true');
    url.searchParams.set('perPage', '100');
    const payload = await requestJson(url);
    assertFreshDataset(payload?.dataset, maxSnapshotAgeSeconds);
    const servers = Array.isArray(payload?.data) ? payload.data : [];
    const exact = servers.find(server => server?.name === requestedName);
    const id = exact?.id ?? exact?.roomId ?? exact?.room_id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new DataSourceError('ReforgerMods', `TLC server was not found by observed name: ${requestedName}`);
    }
    currentServerName = requestedName;
    cachedServerId = id;
    return id;
  }

  async function getServerId() { return cachedServerId || discoverServerId(); }

  function setIdentity({ serverName: nextServerName, serverId: nextServerId } = {}) {
    if (typeof nextServerName === 'string' && nextServerName.trim()) currentServerName = nextServerName.trim();
    if (typeof nextServerId === 'string' && nextServerId.trim()) cachedServerId = nextServerId.trim();
    return { serverName: currentServerName, serverId: cachedServerId };
  }

  function getIdentity() { return { serverName: currentServerName, serverId: cachedServerId }; }

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

  async function fetchReforgerModsStatus() {
    const payload = await getServerPayload();
    return normalizeReforgerModsServer(payload?.server ?? payload?.data);
  }

  async function fetchBattleMetricsStatus() {
    const payload = await requestJson(
      `${battleMetricsBaseUrl}/${encodeURIComponent(battleMetricsServerId)}`,
      'BattleMetrics'
    );
    return normalizeBattleMetricsServer(payload);
  }

  async function fetchStatus() {
    try {
      return await fetchBattleMetricsStatus();
    } catch (battleMetricsError) {
      fallbackWarning(
        'battlemetrics-status',
        '[WARN] BattleMetrics status unavailable; using ReforgerMods fallback:',
        battleMetricsError?.message || battleMetricsError
      );
      const status = await fetchReforgerModsStatus();
      return { ...status, __dataSource: 'ReforgerMods' };
    }
  }

  async function fetchMods({ retryDiscovery = true } = {}) {
    const serverId = await getServerId();
    try {
      const payload = await requestJson(`${baseUrl}/servers/${encodeURIComponent(serverId)}/mods?sizes=false`);
      if (payload?.dataset) assertFreshDataset(payload.dataset, maxSnapshotAgeSeconds);
      const mods = normalizeReforgerModsMods(payload);
      if (mods.length === 0) throw new DataSourceError('ReforgerMods', 'server mod list is empty');
      return mods;
    } catch (error) {
      if (!retryDiscovery) throw error;
      cachedServerId = null;
      await discoverServerId();
      return fetchMods({ retryDiscovery: false });
    }
  }

  return { fetchStatus, fetchMods, discoverServerId, setIdentity, getIdentity };
}

export async function withFallback({ primary, fallback, operation }) {
  try {
    return { value: await primary(), source: 'ArmaHQ' };
  } catch (primaryError) {
    fallbackWarning(
      `armahq-${operation}`,
      `[WARN] ArmaHQ ${operation} unavailable; using secondary source:`,
      primaryError?.message || primaryError
    );
    try {
      const fallbackValue = await fallback();
      const source = fallbackValue?.__dataSource || 'ReforgerMods';
      let value = fallbackValue;

      if (fallbackValue && typeof fallbackValue === 'object' && '__dataSource' in fallbackValue) {
        const { __dataSource, ...cleanValue } = fallbackValue;
        value = cleanValue;
      }

      return { value, source, primaryError };
    } catch (fallbackError) {
      throw new AggregateError([primaryError, fallbackError], `Both server data sources failed during ${operation}`);
    }
  }
}
