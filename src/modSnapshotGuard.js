export const MOD_MASS_REMOVAL_MIN_COUNT = 10;
export const MOD_MASS_REMOVAL_MIN_RATIO = 0.20;
export const MOD_MASS_REMOVAL_CONFIRMATIONS = 2;
export const MOD_CHECK_INTERVAL_MS = 30 * 1000;
export const MOD_REMOVAL_CONFIRMATIONS = 4;

function toIdSet(snapshot) {
  if (snapshot instanceof Map) {
    return new Set(snapshot.keys());
  }

  return new Set(snapshot);
}

export function assessMassRemovalSnapshot(
  previousSnapshot,
  currentSnapshot,
  candidate = null,
  {
    minRemoved = MOD_MASS_REMOVAL_MIN_COUNT,
    minRatio = MOD_MASS_REMOVAL_MIN_RATIO,
    requiredConfirmations = MOD_MASS_REMOVAL_CONFIRMATIONS
  } = {}
) {
  const previousIds = toIdSet(previousSnapshot);
  const currentIds = toIdSet(currentSnapshot);
  const missingIds = [...previousIds]
    .filter(modId => !currentIds.has(modId))
    .sort();

  const missingCount = missingIds.length;
  const missingRatio = previousIds.size > 0
    ? missingCount / previousIds.size
    : 0;
  const suspicious =
    missingCount >= minRemoved &&
    missingRatio >= minRatio;

  if (!suspicious) {
    return {
      accept: true,
      confirmed: false,
      candidate: null,
      missingCount,
      missingRatio
    };
  }

  const signature = missingIds.join('|');
  const confirmations = candidate?.signature === signature
    ? candidate.confirmations + 1
    : 1;
  const confirmed = confirmations >= requiredConfirmations;

  return {
    accept: confirmed,
    confirmed,
    candidate: confirmed ? null : { signature, confirmations },
    confirmations,
    missingCount,
    missingRatio
  };
}

export function advancePendingRemovals(
  previousSnapshot,
  currentSnapshot,
  pendingRemovals,
  {
    initialConfirmations = 1,
    requiredConfirmations = MOD_REMOVAL_CONFIRMATIONS
  } = {}
) {
  const nextPendingRemovals = new Map(pendingRemovals);
  const removedMods = [];
  const recoveredPendingRemovals = new Set();

  for (const [modId, pending] of nextPendingRemovals) {
    if (!currentSnapshot.has(modId)) {
      const confirmations = pending.confirmations + 1;

      if (confirmations >= requiredConfirmations) {
        removedMods.push(pending.mod);
        nextPendingRemovals.delete(modId);
      } else {
        nextPendingRemovals.set(modId, {
          mod: pending.mod,
          confirmations
        });
      }
    } else {
      recoveredPendingRemovals.add(modId);
      nextPendingRemovals.delete(modId);
    }
  }

  for (const [modId, mod] of previousSnapshot) {
    if (!currentSnapshot.has(modId) && !nextPendingRemovals.has(modId)) {
      nextPendingRemovals.set(modId, {
        mod,
        confirmations: initialConfirmations
      });
    }
  }

  return {
    pendingRemovals: nextPendingRemovals,
    recoveredPendingRemovals,
    removedMods
  };
}
