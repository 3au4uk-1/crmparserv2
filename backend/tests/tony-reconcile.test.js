import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { planEventReconciliation } from '../src/services/tony-reconcile.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL,
      deal_key TEXT,
      data_source TEXT NOT NULL DEFAULT 'calendar',
      tony_order_id TEXT,
      title TEXT,
      approval_status TEXT DEFAULT 'pending',
      twenty_id TEXT
    );
  `);
  return db;
}

describe('planEventReconciliation', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => { db.close(); });

  it('plans a single calendar fallback when there are no valid bookings', () => {
    const plan = planEventReconciliation(db, 'evt1', []);
    expect(plan.desired).toEqual([{ dealKey: 'evt1#cal', source: 'calendar', bookingNumber: null }]);
    expect(plan.relink).toBeNull();
    expect(plan.removeDealIds).toEqual([]);
  });

  it('plans one tony deal per valid booking number', () => {
    const plan = planEventReconciliation(db, 'evt1', ['169120', '168973']);
    expect(plan.desired).toEqual([
      { dealKey: 'evt1#169120', source: 'tony', bookingNumber: '169120' },
      { dealKey: 'evt1#168973', source: 'tony', bookingNumber: '168973' },
    ]);
  });

  it('relinks an existing single calendar deal to a single new booking (preserving the row)', () => {
    const id = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, approval_status, twenty_id) VALUES ('evt1', 'evt1#cal', 'calendar', 'approved', 'opp-1') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120']);
    expect(plan.relink).toEqual({ dealId: id, newDealKey: 'evt1#169120', bookingNumber: '169120' });
    expect(plan.removeDealIds).toEqual([]);
  });

  it('marks deals for removal when their booking disappears', () => {
    db.prepare("INSERT INTO deals (crm_event_id, deal_key, data_source, tony_order_id, twenty_id) VALUES ('evt1', 'evt1#169120', 'tony', '169120', 'opp-1')").run();
    const goneId = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, tony_order_id, twenty_id) VALUES ('evt1', 'evt1#168973', 'tony', '168973', 'opp-2') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120']);
    expect(plan.removeDealIds).toEqual([goneId]);
  });
});
