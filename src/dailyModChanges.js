export const MOD_CHANGE_FIELD_VALUE_LIMIT = 1024;
export const MOD_CHANGE_MAX_FIELDS_PER_TYPE = 2;

function normalizeMods(mods) {
  const uniqueMods = new Map();

  for (const mod of Array.isArray(mods) ? mods : []) {
    if (!mod || typeof mod.name !== 'string' || mod.name.trim().length === 0) {
      continue;
    }

    const name = mod.name.trim();
    const modId = typeof mod.modId === 'string' && mod.modId.length > 0
      ? mod.modId
      : name;

    uniqueMods.set(modId, { modId, name });
  }

  return [...uniqueMods.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
}

export function groupDailyModChanges(rows = []) {
  const grouped = { added: [], removed: [] };

  for (const row of rows) {
    if (!row || !['added', 'removed'].includes(row.change_type)) continue;

    grouped[row.change_type].push({
      modId: row.mod_id,
      name: row.mod_name
    });
  }

  return {
    added: normalizeMods(grouped.added),
    removed: normalizeMods(grouped.removed)
  };
}

function buildFieldsForType(type, mods) {
  const normalizedMods = normalizeMods(mods);
  if (normalizedMods.length === 0) return [];

  const isAdded = type === 'added';
  const title = isAdded ? '➕ ADDED MODS' : '🗑️ REMOVED MODS';
  const lines = normalizedMods.map(mod => `• **${mod.name}**`);
  const chunks = [];
  const contentLimit = MOD_CHANGE_FIELD_VALUE_LIMIT - 80;
  let currentChunk = '';
  let includedMods = 0;

  for (const line of lines) {
    const safeLine = line.length <= contentLimit
      ? line
      : `${line.slice(0, contentLimit - 1)}…`;
    const candidate = currentChunk.length > 0
      ? `${currentChunk}\n${safeLine}`
      : safeLine;

    if (candidate.length <= contentLimit) {
      currentChunk = candidate;
      includedMods += 1;
      continue;
    }

    chunks.push(currentChunk);

    if (chunks.length >= MOD_CHANGE_MAX_FIELDS_PER_TYPE) {
      currentChunk = '';
      break;
    }

    currentChunk = safeLine;
    includedMods += 1;
  }

  if (
    currentChunk.length > 0 &&
    chunks.length < MOD_CHANGE_MAX_FIELDS_PER_TYPE
  ) {
    chunks.push(currentChunk);
  }

  const omittedMods = normalizedMods.length - includedMods;

  if (omittedMods > 0 && chunks.length > 0) {
    const omissionLine = `…and ${omittedMods} more (see the mod alert channel).`;
    const lastIndex = chunks.length - 1;
    chunks[lastIndex] = `${chunks[lastIndex]}\n${omissionLine}`;
  }

  return chunks.map((value, index) => ({
    name: index === 0
      ? `${title} (${normalizedMods.length})`
      : `${title} (CONT.)`,
    value,
    inline: false
  }));
}

export function buildDailyModChangeFields(modChanges = {}) {
  return [
    ...buildFieldsForType('added', modChanges.added),
    ...buildFieldsForType('removed', modChanges.removed)
  ];
}
