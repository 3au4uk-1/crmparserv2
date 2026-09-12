import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createEventJournal } from '../src/services/twenty-events/journal.js';
import {
  publishDealLineItemEvent,
  publishRecordEvent,
} from '../src/services/twenty-events/publish-record-event.js';

const journalState = { journal: null, enabled: true };

vi.mock('../src/services/twenty-events/index.js', () => ({
  isTwentyEventsEnabled: () => journalState.enabled,
  getEventJournal: () => journalState.journal,
}));

describe('publishRecordEvent', () => {
  beforeEach(() => {
    journalState.journal = createEventJournal();
    journalState.enabled = true;
  });

  afterEach(() => {
    journalState.journal = null;
    journalState.enabled = true;
  });

  it('appends a dealLineItem create so the board can invalidate immediately', () => {
    const seq = publishDealLineItemEvent('CREATED', 'li-1', {
      after: { id: 'li-1', opportunityId: 'opp-1' },
    });

    expect(seq).toBe(1);
    expect(
      journalState.journal.read({ since: 0, epoch: journalState.journal.epoch }).events,
    ).toEqual([
      {
        action: 'CREATED',
        objectNameSingular: 'dealLineItem',
        recordId: 'li-1',
        properties: { after: { id: 'li-1', opportunityId: 'opp-1' } },
      },
    ]);
  });

  it('returns null when the journal is disabled', () => {
    journalState.enabled = false;
    expect(publishRecordEvent({
      action: 'CREATED',
      objectNameSingular: 'dealLineItem',
      recordId: 'li-1',
    })).toBeNull();
  });

  it('ignores incomplete events', () => {
    expect(publishRecordEvent({ action: 'CREATED' })).toBeNull();
    expect(journalState.journal.size).toBe(0);
  });
});
