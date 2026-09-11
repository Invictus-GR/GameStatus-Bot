export const FALLBACK_WARNING_INTERVAL_MS = 5 * 60 * 1000;

export function createRateLimitedWarning({
  intervalMs = FALLBACK_WARNING_INTERVAL_MS,
  now = () => Date.now(),
  log = (...args) => console.log(...args)
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError('intervalMs must be a non-negative finite number.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof log !== 'function') throw new TypeError('log must be a function.');

  const lastLoggedAt = new Map();

  return function warnRateLimited(key, ...args) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError('warning key must be a non-empty string.');
    }

    const currentTime = Number(now());
    if (!Number.isFinite(currentTime)) {
      throw new TypeError('now() must return a finite timestamp.');
    }

    const previousTime = lastLoggedAt.get(key);
    if (previousTime !== undefined && currentTime - previousTime < intervalMs) {
      return false;
    }

    lastLoggedAt.set(key, currentTime);
    log(...args);
    return true;
  };
}

// Expected upstream/fallback problems stay visible without flooding Railway stderr.
export const fallbackWarning = createRateLimitedWarning();
