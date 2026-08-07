// backend/tests/twenty-events-journal.test.js
import { describe, it, expect, vi } from 'vitest';

import { createEventJournal } from '../src/services/twenty-events/journal.js';

const event = (recordId) => ({
  action: 'UPDATED',
  objectNameSingular: 'opportunity',
  recordId,
  properties: { updatedFields: ['stage'] },
});

describe('createEventJournal', () => {
  it('assigns increasing seq numbers and reports the cursor', () => {
    const journal = createEventJournal();

    expect(journal.cursor).toBe(0);
    expect(journal.append(event('a'))).toBe(1);
    expect(journal.append(event('b'))).toBe(2);
    expect(journal.cursor).toBe(2);
  });

  it('returns only events newer than since', () => {
    const journal = createEventJournal();
    journal.append(event('a'));
    journal.append(event('b'));

    const result = journal.read({ since: 1, epoch: journal.epoch });

    expect(result.reset).toBe(false);
    expect(result.cursor).toBe(2);
    expect(result.events).toEqual([event('b')]);
  });

  it('returns the current cursor without events for a first poll', () => {
    const journal = createEventJournal();
    journal.append(event('a'));

    const result = journal.read({});

    expect(result).toEqual({
      epoch: journal.epoch,
      cursor: 1,
      reset: false,
      events: [],
    });
  });

  it('resets when the client epoch does not match', () => {
    const journal = createEventJournal();
    journal.append(event('a'));

    const result = journal.read({ since: 1, epoch: 'other-epoch' });

    expect(result.reset).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.cursor).toBe(1);
  });

  it('resets when the requested cursor was already evicted', () => {
    const journal = createEventJournal({ maxEntries: 2 });
    journal.append(event('a'));
    journal.append(event('b'));
    journal.append(event('c'));

    expect(journal.size).toBe(2);
    expect(journal.read({ since: 0, epoch: journal.epoch }).reset).toBe(true);
    expect(journal.read({ since: 1, epoch: journal.epoch }).events).toEqual([
      event('b'),
      event('c'),
    ]);
  });

  it('evicts by byte budget as well as by count', () => {
    const journal = createEventJournal({ maxBytes: 200 });
    journal.append({ ...event('a'), padding: 'x'.repeat(300) });
    journal.append(event('b'));

    expect(journal.size).toBe(1);
    expect(journal.read({ since: 1, epoch: journal.epoch }).events).toEqual([event('b')]);
  });

  it('notifies append listeners until they unsubscribe', () => {
    const journal = createEventJournal();
    const listener = vi.fn();
    const unsubscribe = journal.onAppend(listener);

    journal.append(event('a'));
    unsubscribe();
    journal.append(event('b'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

});
