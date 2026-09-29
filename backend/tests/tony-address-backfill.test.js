import { describe, expect, it, vi } from 'vitest';
import { runTonyAddressBackfill, tonyAddressBackfillRows } from '../src/services/tony-address-backfill.js';

describe('tonyAddressBackfillRows', () => {
  it('keeps synced Tony deals with a non-empty address', () => {
    expect(tonyAddressBackfillRows([
      { twenty_id: ' opp-1 ', data_source: 'tony', address: '  Тверская 1 ' },
      { twenty_id: 'opp-2', data_source: 'tony', address: '   ' },
      { twenty_id: 'opp-3', data_source: 'calendar', address: 'Календарь' },
      { twenty_id: '', data_source: 'tony', address: 'Нет id' },
    ])).toEqual([{ twentyId: 'opp-1', address: 'Тверская 1' }]);
  });
});

describe('runTonyAddressBackfill', () => {
  it('patches only address, skips an equal value, and continues after one failure', async () => {
    const db = {
      prepare: () => ({
        all: () => [
          { twenty_id: 'same', data_source: 'tony', address: 'Тверская 1' },
          { twenty_id: 'change', data_source: 'tony', address: 'Новый' },
          { twenty_id: 'bad', data_source: 'tony', address: 'Сломанный' },
        ],
      }),
    };
    const current = { same: 'Тверская 1', change: 'Старый', bad: '' };
    const updates = [];
    const gql = vi.fn(async (_url, _token, query, variables) => {
      if (query.includes('query OpportunityAddress')) {
        return { data: { data: { opportunities: { edges: [{ node: { address: current[variables.id] } }] } } } };
      }
      if (variables.id === 'bad') throw new Error('twenty rejected bad');
      updates.push(variables);
      return { data: { data: { updateOpportunity: { id: variables.id } } } };
    });
    const result = await runTonyAddressBackfill({
      db,
      gql,
      apiUrl: 'http://twenty.test',
      apiToken: 'token',
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    });
    expect(updates).toEqual([{ id: 'change', input: { address: 'Новый' } }]);
    expect(result).toEqual({
      updated: 1,
      skipped: 1,
      failed: [{ twentyId: 'bad', message: 'twenty rejected bad' }],
    });
  });
});
