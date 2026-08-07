// backend/src/services/twenty-events/wait-for-events.js
export const LONG_POLL_TIMEOUT_MS = 25_000;

/**
 * Resolves with journal contents newer than `since`, waiting up to `timeoutMs`
 * when there is nothing yet. Knows only about the journal's read/onAppend contract.
 */
export function waitForEvents(
  journal,
  { since, epoch, timeoutMs = LONG_POLL_TIMEOUT_MS, signal } = {},
) {
  const immediate = journal.read({ since, epoch });
  if (immediate.reset || immediate.events.length > 0 || !Number.isInteger(since)) {
    return Promise.resolve(immediate);
  }
  if (signal?.aborted) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve(journal.read({ since, epoch }));
    };

    const unsubscribe = journal.onAppend(finish);
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', finish);
  });
}
