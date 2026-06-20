import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { planEventReconciliation, desiredDealKeys } from '../src/services/tony-reconcile.js';

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

describe('desiredDealKeys', () => {
  it('returns a single #cal target when the title has no booking numbers', () => {
    expect(desiredDealKeys('evt1', [])).toEqual([{ dealKey: 'evt1#cal', bookingNumber: null }]);
  });

  it('returns one target per booking number, keyed by booking', () => {
    expect(desiredDealKeys('evt1', ['169120', '168973'])).toEqual([
      { dealKey: 'evt1#169120', bookingNumber: '169120' },
      { dealKey: 'evt1#168973', bookingNumber: '168973' },
    ]);
  });
});

describe('planEventReconciliation', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => { db.close(); });

  it('plans a single calendar fallback when the title has no booking numbers', () => {
    const plan = planEventReconciliation(db, 'evt1', []);
    expect(plan.desired).toEqual([{ dealKey: 'evt1#cal', bookingNumber: null }]);
    expect(plan.relink).toBeNull();
    expect(plan.removeDealIds).toEqual([]);
  });

  it('plans one deal per booking number in the title', () => {
    const plan = planEventReconciliation(db, 'evt1', ['169120', '168973']);
    expect(plan.desired).toEqual([
      { dealKey: 'evt1#169120', bookingNumber: '169120' },
      { dealKey: 'evt1#168973', bookingNumber: '168973' },
    ]);
  });

  it('relinks an existing single calendar deal when the title gains exactly one booking', () => {
    const id = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, approval_status, twenty_id) VALUES ('evt1', 'evt1#cal', 'calendar', 'approved', 'opp-1') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120']);
    expect(plan.relink).toEqual({ dealId: id, newDealKey: 'evt1#169120', bookingNumber: '169120' });
    expect(plan.removeDealIds).toEqual([]);
  });

  it('does NOT relink when the title gains multiple bookings (the cal deal is removed instead)', () => {
    const id = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, twenty_id) VALUES ('evt1', 'evt1#cal', 'calendar', 'opp-1') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120', '168973']);
    expect(plan.relink).toBeNull();
    expect(plan.removeDealIds).toEqual([id]);
  });

  it('marks deals for removal when their booking is no longer in the title', () => {
    db.prepare("INSERT INTO deals (crm_event_id, deal_key, data_source, tony_order_id, twenty_id) VALUES ('evt1', 'evt1#169120', 'tony', '169120', 'opp-1')").run();
    const goneId = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, tony_order_id, twenty_id) VALUES ('evt1', 'evt1#168973', 'tony', '168973', 'opp-2') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120']);
    expect(plan.removeDealIds).toEqual([goneId]);
  });
});
