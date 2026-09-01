export const MOD_ALERT_SEND_ATTEMPTS = 3;
export const MOD_ALERT_RETRY_DELAYS_MS = Object.freeze([2000, 5000]);

export function getModAlertKey(alert) {
  const modIds = alert.mods
    .map(mod => mod.modId)
    .sort()
    .join('|');

  return `${alert.type}:${modIds}`;
}

function wait(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function withRetry(
  operation,
  {
    attempts = MOD_ALERT_SEND_ATTEMPTS,
    retryDelaysMs = MOD_ALERT_RETRY_DELAYS_MS,
    sleep = wait,
    onRetry = () => {}
  } = {}
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('Retry attempts must be a positive integer.');
  }

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      const delayIndex = Math.min(attempt - 1, retryDelaysMs.length - 1);
      const delayMs = retryDelaysMs[delayIndex] ?? 0;
      await onRetry({ attempt, delayMs, error, nextAttempt: attempt + 1 });

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

export async function deliverOrQueue(queue, key, alert, deliver) {
  try {
    await deliver(alert);
    queue.delete(key);
    return { delivered: true, error: null, key };
  } catch (error) {
    queue.set(key, alert);
    return { delivered: false, error, key };
  }
}

export async function flushRetryQueue(queue, deliver) {
  const queuedAlerts = [...queue.entries()];

  return Promise.all(
    queuedAlerts.map(([key, alert]) =>
      deliverOrQueue(queue, key, alert, deliver)
    )
  );
}
