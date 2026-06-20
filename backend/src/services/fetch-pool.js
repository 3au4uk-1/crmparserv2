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
