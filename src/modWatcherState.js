import { getModAlertKey } from './modAlertRetry.js';

export const MOD_WATCHER_STATE_VERSION = 1;

function normalizeMod(mod) {
  if (
    !mod ||
    typeof mod !== 'object' ||
    typeof mod.modId !== 'string' ||
    mod.modId.length === 0 ||
    typeof mod.name !== 'string'
  ) {
    return null;
  }

  return {
    name: mod.name,
    modId: mod.modId,
    version: typeof mod.version === 'string' ? mod.version : ''
  };
}

function normalizeMassRemovalCandidate(candidate) {
  if (
    !candidate ||
    typeof candidate.signature !== 'string' ||
    candidate.signature.length === 0 ||
    !Number.isInteger(candidate.confirmations) ||
    candidate.confirmations < 1
  ) {
    return null;
  }

  return {
    signature: candidate.signature,
    confirmations: candidate.confirmations
  };
}

function normalizeAlert(alert) {
  if (
    !alert ||
    !['added', 'removed'].includes(alert.type) ||
    !Array.isArray(alert.mods) ||
    !Number.isInteger(alert.activeMods) ||
    alert.activeMods < 0
  ) {
    return null;
  }

  const mods = alert.mods
    .map(normalizeMod)
    .filter(Boolean)
    .sort((a, b) => a.modId.localeCompare(b.modId));

  if (mods.length === 0) return null;

  return {
    type: alert.type,
    mods,
    activeMods: alert.activeMods
  };
}

export function serializeModWatcherState({
  previousModSnapshot,
  pendingRemovedMods,
  massRemovalCandidate,
  pendingModAlerts
}) {
  const previousSnapshot = previousModSnapshot
    ? [...previousModSnapshot.values()]
      .map(normalizeMod)
      .filter(Boolean)
      .sort((a, b) => a.modId.localeCompare(b.modId))
    : null;
  const pendingRemovals = [...pendingRemovedMods.values()]
    .map(pending => {
      const mod = normalizeMod(pending?.mod);

      if (
        !mod ||
        !Number.isInteger(pending?.confirmations) ||
        pending.confirmations < 1
      ) {
        return null;
      }

      return { mod, confirmations: pending.confirmations };
    })
    .filter(Boolean)
    .sort((a, b) => a.mod.modId.localeCompare(b.mod.modId));
  const pendingAlerts = [...pendingModAlerts.values()]
    .map(normalizeAlert)
    .filter(Boolean)
    .sort((a, b) => getModAlertKey(a).localeCompare(getModAlertKey(b)));

  return {
    version: MOD_WATCHER_STATE_VERSION,
    previousSnapshot,
    pendingRemovals,
    massRemovalCandidate: normalizeMassRemovalCandidate(massRemovalCandidate),
    pendingAlerts
  };
}

export function deserializeModWatcherState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const previousMods = Array.isArray(state.previousSnapshot)
    ? state.previousSnapshot.map(normalizeMod).filter(Boolean)
    : [];
  const previousModSnapshot = previousMods.length > 0
    ? new Map(previousMods.map(mod => [mod.modId, mod]))
    : null;
  const pendingRemovedMods = new Map();

  if (Array.isArray(state.pendingRemovals)) {
    for (const pending of state.pendingRemovals) {
      const mod = normalizeMod(pending?.mod);

      if (
        mod &&
        Number.isInteger(pending?.confirmations) &&
        pending.confirmations >= 1
      ) {
        pendingRemovedMods.set(mod.modId, {
          mod,
          confirmations: pending.confirmations
        });
      }
    }
  }

  const pendingModAlerts = new Map();

  if (Array.isArray(state.pendingAlerts)) {
    for (const rawAlert of state.pendingAlerts) {
      const alert = normalizeAlert(rawAlert);
      if (alert) pendingModAlerts.set(getModAlertKey(alert), alert);
    }
  }

  return {
    previousModSnapshot,
    pendingRemovedMods,
    massRemovalCandidate: normalizeMassRemovalCandidate(
      state.massRemovalCandidate
    ),
    pendingModAlerts
  };
}
