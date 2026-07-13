import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import {
  upsertManualTwentyLineItem,
  archiveManualTwentyLineItem,
} from '../src/services/manual-twenty-line-item.js';

describe('manual-twenty-line-item', () => {
  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status)
      VALUES ('e1', 'e1#cal', 'calendar', 'Deal', 'opp-1', 'synced')
    `).run();
  });

  it('upsertManualTwentyLineItem creates manual row', () => {
    const db = getDb();
    const result = upsertManualTwentyLineItem(db, 'li-1', {
      opportunityId: 'opp-1',
      name: 'Баннер',
      kolichestvo: 2,
      amountMicros: 1_500_000_000,
      currencyCode: 'RUB',
    });
    const row = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(result.dealItemId).toBe(row.id);
    expect(row.classification).toBe('manual_twenty');
    expect(row.sync_override).toBe('include');
    expect(row.name).toBe('Баннер');
    expect(row.quantity_num).toBe(2);
    expect(row.sum).toBe(1500);
  });

  it('upsertManualTwentyLineItem updates existing row', () => {
    const db = getDb();
    upsertManualTwentyLineItem(db, 'li-1', {
      opportunityId: 'opp-1',
      name: 'A',
      kolichestvo: 1,
      amountMicros: 0,
      currencyCode: 'RUB',
    });
    upsertManualTwentyLineItem(db, 'li-1', {
      opportunityId: 'opp-1',
      name: 'B',
      kolichestvo: 3,
      amountMicros: 500_000_000,
      currencyCode: 'RUB',
    });
    const row = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.name).toBe('B');
    expect(row.quantity_num).toBe(3);
  });

  it('archiveManualTwentyLineItem sets exclude', () => {
    const db = getDb();
    upsertManualTwentyLineItem(db, 'li-1', {
      opportunityId: 'opp-1',
      name: 'A',
      kolichestvo: 1,
      amountMicros: 0,
      currencyCode: 'RUB',
    });
    archiveManualTwentyLineItem(db, 'li-1');
    const row = db.prepare('SELECT sync_override FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.sync_override).toBe('exclude');
  });

  it('upsert throws 404 when deal missing', () => {
    const db = getDb();
    expect(() =>
      upsertManualTwentyLineItem(db, 'li-1', {
        opportunityId: 'missing',
        name: 'A',
        kolichestvo: 1,
        amountMicros: 0,
        currencyCode: 'RUB',
      }),
    ).toThrow(/not found/i);
  });
});
