import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { lockDealItemAmount } from '../src/services/deal-item-amount-lock.js';
import {
  computeDealItemsTotal,
  computeLineItemTotal,
} from '../src/services/twenty-opportunity.js';
import { getItemsForTwenty } from '../src/services/twenty-items.js';
import { getCachedPatternLists, resetPatternListsCacheForTests } from '../src/services/pattern-lists-cache.js';

function expectHttpError(fn, status, messagePart) {
  try {
    fn();
    throw new Error('Expected error');
  } catch (err) {
    expect(err.status).toBe(status);
    if (messagePart) expect(err.message).toContain(messagePart);
  }
}

describe('lockDealItemAmount', () => {
  let dealId;

  beforeEach(() => {
    resetPatternListsCacheForTests();
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare('DELETE FROM restoration_items').run();
    db.prepare('DELETE FROM ne_nashe_branding_items').run();
    db.prepare('DELETE FROM ne_nashe_decor_mk_items').run();

    const dealResult = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#tony', 'tony', 'Test deal', 'opp-1', 'synced')
    `).run();
    dealId = dealResult.lastInsertRowid;

    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, sum, classification, twenty_id)
      VALUES (?, 'Баннер 3x6', 10000, '2', 20000, 'keyword_match', 'li-1')
    `).run(dealId);

    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, sum, classification, twenty_id)
      VALUES (?, 'Стойка', 5000, '1', 5000, 'keyword_match', 'li-2')
    `).run(dealId);
  });

  it('sets amount_locked and sum, returns opportunity total', () => {
    const db = getDb();
    const result = lockDealItemAmount(db, 'li-1', 15000);

    expect(result).toEqual({
      dealId,
      itemId: expect.any(Number),
      amountRub: 15000,
      opportunityAmountRub: 20000,
    });

    const row = db.prepare('SELECT amount_locked, sum, price, quantity FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.amount_locked).toBe(1);
    expect(row.sum).toBe(15000);
    expect(row.price).toBe(10000);
    expect(row.quantity).toBe('2');
  });

  it('throws 404 when twenty_id is unknown', () => {
    const db = getDb();
    expectHttpError(() => lockDealItemAmount(db, 'missing-li', 1000), 404, 'Line item not found');
  });

  it('throws 400 when amountRub is invalid', () => {
    const db = getDb();
    expectHttpError(() => lockDealItemAmount(db, 'li-1', -1), 400, 'Amount');
    expectHttpError(() => lockDealItemAmount(db, 'li-1', NaN), 400, 'Amount');
    expectHttpError(() => lockDealItemAmount(db, 'li-1', Infinity), 400, 'Amount');
  });

  it('allows zero amountRub', () => {
    const db = getDb();
    const result = lockDealItemAmount(db, 'li-1', 0);
    expect(result.amountRub).toBe(0);
    const row = db.prepare('SELECT amount_locked, sum FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.amount_locked).toBe(1);
    expect(row.sum).toBe(0);
  });

  it('throws 400 for restoration match', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO restoration_items (pattern, match_type, source_name)
      VALUES ('баннер 3x6', 'exact', 'Баннер 3x6')
    `).run();
    resetPatternListsCacheForTests();

    expectHttpError(
      () => lockDealItemAmount(db, 'li-1', 15000),
      400,
      'restoration',
    );
  });

  it('throws 400 for ne-nashe branding match', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO ne_nashe_branding_items (pattern, match_type, source_name)
      VALUES ('баннер 3x6', 'exact', 'Баннер 3x6')
    `).run();
    resetPatternListsCacheForTests();

    expectHttpError(
      () => lockDealItemAmount(db, 'li-1', 15000),
      400,
      'ne-nashe',
    );
  });

  it('throws 400 for ne-nashe decor-mk match', () => {
    const db = getDb();
    db.prepare(`
      UPDATE deal_items SET name = 'Декор стойка', twenty_id = 'li-decor' WHERE twenty_id = 'li-1'
    `).run();
    db.prepare(`
      INSERT INTO ne_nashe_decor_mk_items (pattern, match_type, source_name)
      VALUES ('декор стойка', 'exact', 'Декор стойка')
    `).run();
    resetPatternListsCacheForTests();

    expectHttpError(
      () => lockDealItemAmount(db, 'li-decor', 15000),
      400,
      'ne-nashe',
    );
  });

  it('opportunityAmountRub uses eligible items only', () => {
    const db = getDb();
    db.prepare(`
      UPDATE deal_items SET sync_override = 'exclude' WHERE twenty_id = 'li-2'
    `).run();

    const result = lockDealItemAmount(db, 'li-1', 15000);
    expect(result.opportunityAmountRub).toBe(15000);
  });
});

describe('computeLineItemTotal amount_locked', () => {
  const deal = { data_source: 'tony' };

  it('locked computeLineItemTotal uses price × qty', () => {
    const item = {
      name: 'Баннер',
      price: 10000,
      quantity: '2',
      sum: 18000,
      amount_locked: 1,
    };
    expect(computeLineItemTotal(item, deal)).toBe(20000);
  });

  it('returns 0 when locked price is not finite', () => {
    const item = { name: 'Баннер', sum: null, amount_locked: 1 };
    expect(computeLineItemTotal(item, deal)).toBe(0);
  });

  it('restoration still zeroes before locked branch', () => {
    const restorationList = [{ id: 1, pattern: 'колесо', matchType: 'exact' }];
    const item = {
      name: 'Колесо',
      sum: 99999,
      amount_locked: 1,
    };
    expect(computeLineItemTotal(item, deal, restorationList)).toBe(0);
  });

  it('locked item contributes to computeDealItemsTotal', () => {
    const items = [
      { name: 'A', price: 10000, sum: 12000, amount_locked: 1 },
      { name: 'B', price: 5000, sum: 5000 },
    ];
    expect(computeDealItemsTotal(deal, items)).toBe(15000);
  });

  it('locked total used in opportunity calc with pattern lists', () => {
    const db = getDb();
    initDb();
    migrate();
    resetPatternListsCacheForTests();

    const dealRow = { data_source: 'tony' };
    const items = [
      { name: 'Баннер', price: 10000, sum: 7500, amount_locked: 1, classification: 'keyword_match' },
      { name: 'Стойка', price: 3000, sum: 3000, classification: 'keyword_match' },
    ];
    const { streamContext, restorationList, neNasheBrandingList, neNasheDecorMkList } = getCachedPatternLists(db);
    const eligible = getItemsForTwenty(items, streamContext);
    const total = computeDealItemsTotal(
      dealRow,
      eligible,
      restorationList,
      { neNasheBrandingList, neNasheDecorMkList },
    );
    expect(total).toBe(13000);
  });
});
