// backend/src/services/twenty-events/journal.js
import crypto from 'node:crypto';

const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * In-memory, cursor-addressed log of Twenty record events.
 * Knows nothing about Twenty transport — only storage, eviction and notification.
 */
export function createEventJournal({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const epoch = crypto.randomUUID();
  const entries = [];
  const listeners = new Set();
  let nextSeq = 1;
  let totalBytes = 0;

  const evict = () => {
    while (
      entries.length > maxEntries ||
      (totalBytes > maxBytes && entries.length > 1)
    ) {
      totalBytes -= entries.shift().bytes;
    }
  };

  return {
    epoch,

    get cursor() {
      return nextSeq - 1;
    },

    get size() {
      return entries.length;
    },

    append(event) {
      const seq = nextSeq;
      const bytes = Buffer.byteLength(JSON.stringify(event));
      nextSeq += 1;
      entries.push({ seq, receivedAt: Date.now(), event, bytes });
      totalBytes += bytes;
      evict();
      for (const listener of [...listeners]) listener(seq);
      return seq;
    },

    read({ since, epoch: clientEpoch } = {}) {
      const cursor = nextSeq - 1;

      if (!Number.isInteger(since) || clientEpoch === undefined) {
        return { epoch, cursor, reset: false, events: [] };
      }

      if (clientEpoch !== epoch) {
        return { epoch, cursor, reset: true, events: [] };
      }

      const oldestSeq = entries.length > 0 ? entries[0].seq : cursor + 1;
      if (since < oldestSeq - 1) {
        return { epoch, cursor, reset: true, events: [] };
      }

      return {
        epoch,
        cursor,
        reset: false,
        events: entries.filter((entry) => entry.seq > since).map((entry) => entry.event),
      };
    },

    onAppend(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
