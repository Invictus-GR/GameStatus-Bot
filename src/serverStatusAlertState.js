export const SERVER_STATUS_CHECK_INTERVAL_MS = 30 * 1000;
export const SERVER_OFFLINE_CONFIRMATIONS = 3;

function isTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}

function normalizeAlert(alert) {
  if (!alert || typeof alert !== 'object' || typeof alert.id !== 'string') {
    return null;
  }

  if (alert.type === 'down' && isTimestamp(alert.detectedAt)) {
    return {
      id: alert.id,
      type: 'down',
      detectedAt: alert.detectedAt
    };
  }

  if (
    alert.type === 'recovered' &&
    isTimestamp(alert.outageStartedAt) &&
    isTimestamp(alert.recoveredAt)
  ) {
    return {
      id: alert.id,
      type: 'recovered',
      outageStartedAt: alert.outageStartedAt,
      recoveredAt: alert.recoveredAt
    };
  }

  return null;
}

export function createServerStatusAlertState() {
  return {
    confirmedStatus: null,
    consecutiveOfflineChecks: 0,
    firstOfflineDetectedAt: null,
    outageStartedAt: null,
    pendingAlerts: []
  };
}

export function deserializeServerStatusAlertState(value) {
  if (!value || typeof value !== 'object') {
    return createServerStatusAlertState();
  }

  const confirmedStatus = ['online', 'offline'].includes(value.confirmedStatus)
    ? value.confirmedStatus
    : null;
  const consecutiveOfflineChecks = Number.isInteger(value.consecutiveOfflineChecks) &&
    value.consecutiveOfflineChecks >= 0
    ? value.consecutiveOfflineChecks
    : 0;
  const firstOfflineDetectedAt = isTimestamp(value.firstOfflineDetectedAt)
    ? value.firstOfflineDetectedAt
    : null;
  const outageStartedAt = isTimestamp(value.outageStartedAt)
    ? value.outageStartedAt
    : null;
  const pendingAlerts = Array.isArray(value.pendingAlerts)
    ? value.pendingAlerts.map(normalizeAlert).filter(Boolean)
    : [];

  return {
    confirmedStatus,
    consecutiveOfflineChecks,
    firstOfflineDetectedAt,
    outageStartedAt,
    pendingAlerts
  };
}

export function serializeServerStatusAlertState(state) {
  return deserializeServerStatusAlertState(state);
}

export function observeServerStatus(
  state,
  { isOnline, checkedAt = Date.now() },
  { requiredOfflineConfirmations = SERVER_OFFLINE_CONFIRMATIONS } = {}
) {
  if (!Number.isInteger(requiredOfflineConfirmations) || requiredOfflineConfirmations < 1) {
    throw new RangeError('Offline confirmations must be a positive integer.');
  }

  if (!isTimestamp(checkedAt)) {
    throw new TypeError('checkedAt must be a valid timestamp.');
  }

  const current = deserializeServerStatusAlertState(state);
  const pendingAlerts = [...current.pendingAlerts];

  if (isOnline) {
    const recovered = current.confirmedStatus === 'offline';

    if (recovered) {
      const outageStartedAt = current.outageStartedAt ?? checkedAt;
      pendingAlerts.push({
        id: `recovered:${checkedAt}`,
        type: 'recovered',
        outageStartedAt,
        recoveredAt: checkedAt
      });
    }

    return {
      state: {
        confirmedStatus: 'online',
        consecutiveOfflineChecks: 0,
        firstOfflineDetectedAt: null,
        outageStartedAt: null,
        pendingAlerts
      },
      confirmedStatus: 'online',
      transition: recovered ? 'recovered' : null
    };
  }

  if (current.confirmedStatus === 'offline') {
    return {
      state: current,
      confirmedStatus: 'offline',
      transition: null
    };
  }

  const consecutiveOfflineChecks = current.consecutiveOfflineChecks + 1;
  const firstOfflineDetectedAt = current.firstOfflineDetectedAt ?? checkedAt;

  if (consecutiveOfflineChecks < requiredOfflineConfirmations) {
    return {
      state: {
        ...current,
        consecutiveOfflineChecks,
        firstOfflineDetectedAt
      },
      confirmedStatus: current.confirmedStatus,
      transition: 'pending-offline'
    };
  }

  pendingAlerts.push({
    id: `down:${firstOfflineDetectedAt}`,
    type: 'down',
    detectedAt: firstOfflineDetectedAt
  });

  return {
    state: {
      confirmedStatus: 'offline',
      consecutiveOfflineChecks,
      firstOfflineDetectedAt,
      outageStartedAt: firstOfflineDetectedAt,
      pendingAlerts
    },
    confirmedStatus: 'offline',
    transition: 'down'
  };
}

export function markServerStatusAlertDelivered(state, alertId) {
  const current = deserializeServerStatusAlertState(state);

  return {
    ...current,
    pendingAlerts: current.pendingAlerts.filter(alert => alert.id !== alertId)
  };
}
