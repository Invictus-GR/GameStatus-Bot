const MOD_ALERT_TITLES = Object.freeze({
  added: new Set(['➕ TLC MOD ADDED', '➕ TLC MODS ADDED']),
  removed: new Set(['🗑️ TLC MOD REMOVED', '🗑️ TLC MODS REMOVED'])
});

function normalizeName(name) {
  return name.normalize('NFKC').trim();
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createHistoricalModId(name) {
  const normalizedName = normalizeName(name).toLocaleLowerCase('en-US');
  return `discord-history:${encodeURIComponent(normalizedName)}`;
}

export function parseHistoricalModAlertEmbed(embed, type, detectedAt) {
  if (
    !embed ||
    !['added', 'removed'].includes(type) ||
    !MOD_ALERT_TITLES[type].has(embed.title) ||
    typeof embed.description !== 'string'
  ) {
    return [];
  }

  const timestamp = normalizeTimestamp(detectedAt);
  if (!timestamp) return [];

  const mods = [];
  const modLinePattern = /^•\s+\*\*(.+?)\*\*\s*$/gm;
  let match;

  while ((match = modLinePattern.exec(embed.description)) !== null) {
    const name = normalizeName(match[1]);
    if (!name) continue;

    mods.push({
      type,
      modId: createHistoricalModId(name),
      name,
      detectedAt: timestamp
    });
  }

  return mods;
}

export function mergeHistoricalModChanges(changes = []) {
  const uniqueChanges = new Map();

  for (const change of changes) {
    if (
      !change ||
      !['added', 'removed'].includes(change.type) ||
      typeof change.modId !== 'string' ||
      change.modId.length === 0 ||
      typeof change.name !== 'string' ||
      !normalizeTimestamp(change.detectedAt)
    ) {
      continue;
    }

    const normalizedChange = {
      type: change.type,
      modId: change.modId,
      name: normalizeName(change.name),
      detectedAt: normalizeTimestamp(change.detectedAt)
    };
    const key = `${normalizedChange.type}:${normalizedChange.modId}`;
    const existing = uniqueChanges.get(key);

    if (
      !existing ||
      Date.parse(normalizedChange.detectedAt) < Date.parse(existing.detectedAt)
    ) {
      uniqueChanges.set(key, normalizedChange);
    }
  }

  return [...uniqueChanges.values()].sort((a, b) =>
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
}
