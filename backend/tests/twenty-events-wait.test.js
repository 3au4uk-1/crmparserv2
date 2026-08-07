// backend/tests/twenty-events-wait.test.js
import { describe, it, expect } from 'vitest';

import { createEventJournal } from '../src/services/twenty-events/journal.js';
import {
  LONG_POLL_TIMEOUT_MS,
  waitForEvents,
} from '../src/services/twenty-events/wait-for-events.js';

const event = (recordId) => ({
  action: 'UPDATED',
  objectNameSingular: 'dealLineItem',
  recordId,
  properties: {},
});

describe('waitForEvents', () => {
  it('uses a 25 second hold by default', () => {
    expect(LONG_POLL_TIMEOUT_MS).toBe(25_000);
  });

  it('returns immediately when events are already newer than the cursor', async () => {
    const journal = createEventJournal();
    journal.append(event('a'));

    const result = await waitForEvents(journal, {
      since: 0,
      epoch: journal.epoch,
      timeoutMs: 50,
    });

    expect(result.events).toEqual([event('a')]);
  });

  it('returns immediately on a first poll without a cursor', async () => {
    const journal = createEventJournal();

    const result = await waitForEvents(journal, { timeoutMs: 50 });

    expect(result).toEqual({
      epoch: journal.epoch,
      cursor: 0,
      reset: false,
      events: [],
    });
  });

  it('resolves as soon as an event is appended while waiting', async () => {
    const journal = createEventJournal();
    const pending = waitForEvents(journal, {
      since: 0,
      epoch: journal.epoch,
      timeoutMs: 5000,
    });

    setTimeout(() => journal.append(event('b')), 10);
    const result = await pending;

    expect(result.events).toEqual([event('b')]);
  });

  it('resolves empty after the timeout', async () => {
    const journal = createEventJournal();

    const result = await waitForEvents(journal, {
      since: 0,
      epoch: journal.epoch,
      timeoutMs: 20,
    });

    expect(result.events).toEqual([]);
    expect(result.cursor).toBe(0);
  });

  it('resolves when the request is aborted', async () => {
    const journal = createEventJournal();
    const controller = new AbortController();
    const pending = waitForEvents(journal, {
      since: 0,
      epoch: journal.epoch,
      timeoutMs: 5000,
      signal: controller.signal,
    });

    controller.abort();
    const result = await pending;

    expect(result.events).toEqual([]);
  });
});
