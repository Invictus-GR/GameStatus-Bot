export const ROLLING_MOD_ALERT_DESCRIPTION_LIMIT = 3900;

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeMod(mod) {
  if (
    !mod ||
    typeof mod.modId !== 'string' ||
    mod.modId.length === 0 ||
    typeof mod.name !== 'string' ||
    mod.name.trim().length === 0
  ) {
    return null;
  }

  return {
    modId: mod.modId,
    name: mod.name.trim()
  };
}

export function createRollingModEventRows(alert) {
  if (
    !alert ||
    !['added', 'removed'].includes(alert.type) ||
    !Array.isArray(alert.mods)
  ) {
    throw new TypeError('Invalid rolling mod alert.');
  }

  const detectedAt = normalizeTimestamp(alert.detectedAt);
  if (!detectedAt) {
    throw new TypeError('Rolling mod alert requires a valid detection time.');
  }

  const uniqueMods = new Map();
  for (const candidate of alert.mods) {
    const mod = normalizeMod(candidate);
    if (mod) uniqueMods.set(mod.modId, mod);
  }

  return [...uniqueMods.values()].map(mod => ({
    eventKey: [
      alert.type,
      detectedAt,
      encodeURIComponent(mod.modId)
    ].join(':'),
    type: alert.type,
    modId: mod.modId,
    name: mod.name,
    detectedAt
  }));
}

export function groupRollingModEvents(rows = []) {
  const eventsByTimestamp = new Map();
  const seenRows = new Set();

  for (const row of rows) {
    const type = row?.type ?? row?.change_type;
    const modId = row?.modId ?? row?.mod_id;
    const name = row?.name ?? row?.mod_name;
    const detectedAt = normalizeTimestamp(row?.detectedAt ?? row?.detected_at);

    if (
      !['added', 'removed'].includes(type) ||
      typeof modId !== 'string' ||
      modId.length === 0 ||
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      !detectedAt
    ) {
      continue;
    }

    const rowKey = `${type}:${detectedAt}:${modId}`;
    if (seenRows.has(rowKey)) continue;
    seenRows.add(rowKey);

    const eventKey = `${type}:${detectedAt}`;
    if (!eventsByTimestamp.has(eventKey)) {
      eventsByTimestamp.set(eventKey, {
        type,
        detectedAt,
        mods: []
      });
    }

    eventsByTimestamp.get(eventKey).mods.push({
      modId,
      name: name.trim()
    });
  }

  return [...eventsByTimestamp.values()]
    .map(event => ({
      ...event,
      mods: event.mods.sort((a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
      )
    }))
    .sort((a, b) =>
      Date.parse(a.detectedAt) - Date.parse(b.detectedAt) ||
      a.type.localeCompare(b.type)
    );
}

function formatEventBlock(event, isLatest) {
  const unixSeconds = Math.floor(Date.parse(event.detectedAt) / 1000);
  const label = isLatest ? ' — **LATEST**' : '';
  const modList = event.mods
    .map(mod => `• **${mod.name}**`)
    .join('\n');

  return `**<t:${unixSeconds}:f>**${label}\n${modList}`;
}

export function buildRollingModAlertDescription(
  events,
  maxLength = ROLLING_MOD_ALERT_DESCRIPTION_LIMIT
) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('At least one rolling mod event is required.');
  }

  const blocks = events.map((event, index) =>
    formatEventBlock(event, index === events.length - 1)
  );
  let visibleBlocks = [...blocks];
  let hiddenCount = 0;

  while (visibleBlocks.length > 1) {
    const prefix = hiddenCount > 0
      ? `*${hiddenCount} earlier update(s) hidden.*\n\n`
      : '';
    const candidate = `${prefix}${visibleBlocks.join('\n\n')}`;
    if (candidate.length <= maxLength) return candidate;

    visibleBlocks.shift();
    hiddenCount += 1;
  }

  const prefix = hiddenCount > 0
    ? `*${hiddenCount} earlier update(s) hidden.*\n\n`
    : '';
  const finalDescription = `${prefix}${visibleBlocks[0]}`;

  return finalDescription.length <= maxLength
    ? finalDescription
    : finalDescription.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

export function countRollingModChanges(events = []) {
  return events.reduce((total, event) => total + event.mods.length, 0);
}
