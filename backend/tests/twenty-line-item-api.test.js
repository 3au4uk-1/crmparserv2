import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import {
  addDealItemToList,
  findDealItemByTwentyId,
  getLineItemListStatus,
} from '../src/services/twenty-line-item-api.js';

describe('twenty-line-item-api', () => {
  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare('DELETE FROM restoration_items').run();

    const dealResult = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Test deal', 'opp-twenty-1', 'synced')
    `).run();

    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification, twenty_id)
      VALUES (?, 'Велотележка для мороженого', 5000, '1', 'keyword_match', 'li-twenty-1')
    `).run(dealResult.lastInsertRowid);
  });

  it('findDealItemByTwentyId returns item and deal', () => {
    const db = getDb();
    const result = findDealItemByTwentyId(db, 'li-twenty-1');
    expect(result.item.name).toBe('Велотележка для мороженого');
    expect(result.deal.twenty_id).toBe('opp-twenty-1');
  });

  it('findDealItemByTwentyId throws 404 when missing', () => {
    const db = getDb();
    expect(() => findDealItemByTwentyId(db, 'missing')).toThrow('Line item not found in parser');
  });

  it('getLineItemListStatus returns neutral status when line item is missing', () => {
    const db = getDb();
    expect(getLineItemListStatus(db, 'missing')).toEqual({
      known: false,
      blacklisted: false,
      restorationMatch: false,
      podryadMatch: false,
      bannerMatch: false,
      pattern: null,
      dealId: null,
      dealTwentyId: null,
    });
  });

  it('getLineItemListStatus reflects restoration match', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO restoration_items (pattern, match_type, source_name)
      VALUES ('велотележка для мороженого', 'exact', 'Велотележка для мороженого')
    `).run();

    const status = getLineItemListStatus(db, 'li-twenty-1');
    expect(status.restorationMatch).toBe(true);
    expect(status.dealTwentyId).toBe('opp-twenty-1');
  });

  it('addDealItemToList creates restoration entry', () => {
    const db = getDb();
    const { deal } = addDealItemToList(db, 'li-twenty-1', 'restoration');
    expect(deal.id).toBeTruthy();
    const rows = db.prepare('SELECT * FROM restoration_items').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].pattern).toBe('велотележка для мороженого');
  });

  it('addDealItemToList is idempotent on duplicate', () => {
    const db = getDb();
    addDealItemToList(db, 'li-twenty-1', 'restoration');
    expect(() => addDealItemToList(db, 'li-twenty-1', 'restoration')).not.toThrow();
    const rows = db.prepare('SELECT * FROM restoration_items').all();
    expect(rows).toHaveLength(1);
  });
});
