import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncDealToTwentyMock = vi.fn();

vi.mock('../src/db/connection.js', () => {
  const deals = new Map();
  return {
    getDb: () => ({
      prepare(sql) {
        return {
          get(id) {
            if (sql.includes('SELECT twenty_id FROM deals')) {
              return deals.get(id) || null;
            }
            return null;
          },
        };
      },
    }),
    __seedDeal(id, twenty_id) {
      deals.set(id, { twenty_id });
    },
    __reset() {
      deals.clear();
    },
  };
});

vi.mock('../src/services/twenty-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { getDb } = await import('../src/db/connection.js');
  return {
    ...actual,
    syncDealToTwenty: (...args) => syncDealToTwentyMock(...args),
    resyncDealIfSynced: async (dealId) => {
      const db = getDb();
      const deal = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(dealId);
      if (!deal?.twenty_id) return null;
      return syncDealToTwentyMock(dealId);
    },
  };
});

import * as dbMock from '../src/db/connection.js';
import { resyncDealIfSynced } from '../src/services/twenty-sync.js';

describe('resyncDealIfSynced', () => {
  beforeEach(() => {
    dbMock.__reset();
    syncDealToTwentyMock.mockReset();
    syncDealToTwentyMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });
  });

  it('returns null when deal has no twenty_id', async () => {
    dbMock.__seedDeal(1, null);
    const result = await resyncDealIfSynced(1);
    expect(result).toBeNull();
    expect(syncDealToTwentyMock).not.toHaveBeenCalled();
  });

  it('calls syncDealToTwenty when twenty_id present', async () => {
    dbMock.__seedDeal(2, 'opp-2');
    const result = await resyncDealIfSynced(2);
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(2);
    expect(result).toEqual({ action: 'updated', twentyId: 'opp-1' });
  });
});
