/**
 * Create a concurrency limiter. `run(fn)` queues `fn` and resolves with its result,
 * guaranteeing no more than `concurrency` `fn`s are in flight at once (FIFO).
 * `minSpacingMs` (optional) enforces a minimum gap between successive task *starts*;
 * leave at 0 for pure concurrency limiting (spacing throttles total throughput).
 */
export function createPool({ concurrency = 4, minSpacingMs = 0 } = {}) {
  let active = 0;
  let lastStart = 0;
  const queue = [];

  function schedule() {
    if (active >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    active++;
    (async () => {
      if (minSpacingMs > 0) {
        const wait = Math.max(0, lastStart + minSpacingMs - Date.now());
        lastStart = Date.now() + wait;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        active--;
        schedule();
      }
    })();
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      schedule();
    });
  };
}

/** Retry `fn` on retryable errors with exponential backoff + jitter. */
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, isRetryable = () => true } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries || !isRetryable(err)) throw err;
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * baseDelayMs;
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }
}
