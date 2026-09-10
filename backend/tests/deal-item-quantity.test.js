import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { writeDealItemQuantity } from '../src/services/deal-item-quantity.js';
import { lockDealItemAmount } from '../src/services/deal-item-amount-lock.js';
import { resetPatternListsCacheForTests } from '../src/services/pattern-lists-cache.js';
import { buildLineItemUpdateInput } from '../src/services/twenty-line-item.js';

function expectHttpError(fn, status, messagePart) {
  try {
    fn();
    throw new Error('Expected error');
  } catch (err) {
    expect(err.status).toBe(status);
    if (messagePart) expect(err.message).toContain(messagePart);
  }
}

describe('writeDealItemQuantity', () => {
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
    const dealId = dealResult.lastInsertRowid;

    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, sum, classification, twenty_id)
      VALUES (?, 'Баннер 3x6', 10000, '2', 20000, 'keyword_match', 'li-1')
    `).run(dealId);

    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, sum, classification, twenty_id)
      VALUES (?, 'Стойка', 5000, '1', 5000, 'keyword_match', 'li-2')
    `).run(dealId);
  });

  it('updates qty without locking', () => {
    const db = getDb();
    const result = writeDealItemQuantity(db, 'li-1', 3);
    const row = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.quantity_num).toBe(3);
    expect(row.price).toBe(10000);
    expect(row.sum).toBe(30000);
    expect(row.amount_locked).toBe(0);
    expect(result.kolichestvo).toBe(3);
    expect(result.opportunityAmountRub).toBe(35000);
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(row.deal_id);
    const input = buildLineItemUpdateInput(row, { deal });
    expect(input.amount.amountMicros).toBe(10_000_000_000);
  });

  it('locked row keeps unit price and refreshes sum', () => {
    const db = getDb();
    lockDealItemAmount(db, 'li-1', 6000);
    writeDealItemQuantity(db, 'li-1', 3);
    const row = db.prepare('SELECT price, sum, amount_locked FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.amount_locked).toBe(1);
    expect(row.price).toBe(6000);
    expect(row.sum).toBe(18000);
  });

  it('throws 400 for non-positive qty', () => {
    expectHttpError(() => writeDealItemQuantity(getDb(), 'li-1', 0), 400, 'kolichestvo');
  });
});
