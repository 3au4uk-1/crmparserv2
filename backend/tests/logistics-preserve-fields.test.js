import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';
import { applyEvent } from '../src/services/parser.js';
import { parseDealDescription } from '../src/services/html-parser.js';
import { buildDescriptionHtml, toCalendarEvent } from '../src/services/logistics-source.js';
import { buildOpportunityInput } from '../src/services/twenty-opportunity.js';

const window = ['2026-06-16T00:00:00+03:00', '2026-06-20T23:59:59+03:00'];

const order = {
  id: '169120',
  dealId: '777001',
  title: 'ПРО/16.06-20.06/ПЛОЩАДКА/169120/Шунькин',
  client: 'ООО Ромашка',
  loadDate: '2026-06-16',
  loadTime: '04:00',
  returnDate: '2026-06-20',
  returnTime: '18:00',
  returnEnd: '21:00',
  contactName: 'Чернов Михаил',
  contactPhone: '+7 (999) 111-22-33',
  address: 'г Москва, Ленинградское шоссе, д 46',
  statusLabel: 'В резерве',
  statusCode: '5',
};

function logisticsData(extraHtml = '', tonyOrder = null) {
  const descHtml = `${buildDescriptionHtml(order, [
    { name: 'Баннер', price: '1500', quantity: '2', discount: '0' },
  ])}${extraHtml}`;
  const tonyOrders = new Map();
  if (tonyOrder) tonyOrders.set('169120', tonyOrder);
  return {
    bookingNumbers: ['169120'],
    descHtml,
    calParsed: parseDealDescription(descHtml),
    calPayments: null,
    tonyOrders,
  };
}

function ctx() {
  return {
    knownCodes: ['ПРО', 'АРТ', 'АРЕНДА'],
    keywords: [],
    llmPrompt: '',
    counters: { newDeals: 0, updatedDeals: 0, skippedDeals: 0, cancelledDeals: 0, restoredDeals: 0 },
    dealsToResync: [],
  };
}

describe('logistics re-parse keeps fields Tony cannot provide', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
  });

  afterEach(() => db.close());

  function insertStoredDeal(dataSource = 'calendar') {
    db.prepare(`
      INSERT INTO deals (
        crm_event_id, deal_key, data_source, title, company_code, manager_name,
        start_date, end_date, department, status, legal_entity, invoice_number,
        budget, discount, contact_name, contact_email, contact_company, contact_phone,
        address, venue_type, arrival_time, ready_time, work_time, dismantle_time,
        payment_amount, payment_status, payment_count, payment_hash, content_hash
      ) VALUES (
        '169120', 'booking#169120', ?, 'OLD TITLE', 'ПРО', 'Шунькин',
        '2026-06-01T00:00:00+03:00', '2026-06-02T00:00:00+03:00', 'Брендинг', 'В работе',
        'ООО Старое', 'СЧ-100', '450000', '15%', 'Старое имя', 'old@example.com', 'Старая компания', '+70000000000',
        'старый адрес', 'улица', '08:00', '09:00', '10:00-12:00', '13:00',
        235752, 'PREDOPLATA', 2, 'keep-hash', 'old-hash'
      )
    `).run(dataSource);
  }

  function storedRow() {
    return db.prepare(`
      SELECT department, status, legal_entity, invoice_number, budget, discount,
             contact_email, venue_type, ready_time,
             payment_amount, payment_status, payment_count, payment_hash,
             contact_name, contact_phone, contact_company, address, title
      FROM deals WHERE id = 1
    `).get();
  }

  it('does not clear payment, budget, department, email, legal entity, or invoice', async () => {
    insertStoredDeal('calendar');
    const event = toCalendarEvent(order, ...window);
    expect(event.department).toBeUndefined();

    const run = ctx();
    await applyEvent(db, event, '169120', logisticsData(), run);

    const row = storedRow();
    expect(row.department).toBe('Брендинг');
    expect(row.legal_entity).toBe('ООО Старое');
    expect(row.invoice_number).toBe('СЧ-100');
    expect(String(row.budget)).toBe('450000');
    expect(row.discount).toBe('15%');
    expect(row.contact_email).toBe('old@example.com');
    expect(row.venue_type).toBe('улица');
    expect(row.ready_time).toBe('09:00');
    expect(row.payment_amount).toBe(235752);
    expect(row.payment_status).toBe('PREDOPLATA');
    expect(row.payment_count).toBe(2);
    expect(row.payment_hash).toBe('keep-hash');
    expect(row.title).toBe(order.title);
    expect(row.contact_name).toBe('Чернов Михаил');
    expect(row.contact_phone).toBe('+7 (999) 111-22-33');
    expect(row.contact_company).toBe('ООО Ромашка');
    expect(row.address).toBe('г Москва, Ленинградское шоссе, д 46');
    expect(row.status).toBe('В резерве');
    expect(run.counters.updatedDeals).toBe(1);

    const opportunity = buildOpportunityInput(
      db.prepare('SELECT * FROM deals WHERE id = 1').get(),
      [],
      { bitrixLinks: [] },
    );
    expect(opportunity.summaPostupleniy).toEqual({ amountMicros: 235752_000_000, currencyCode: 'RUB' });
    expect(opportunity.statusOplaty).toBe('PREDOPLATA');
  });

  it('does not replace the stored budget with a Tony item sum', async () => {
    insertStoredDeal('tony');
    const event = toCalendarEvent(order, ...window);
    const tonyOrder = {
      items: [{ name: 'Баннер', price: 10, quantity: '1', discount: 0, sum: 999999, comment: '' }],
      dates: {
        loadDate: '16.06.2026',
        loadTime: '04:00',
        eventBegin: '16.06.2026',
        eventEnd: '20.06.2026',
        deinstallDate: '',
        deinstallTime: '',
        workTimeBegin: '',
        workTimeEnd: '',
      },
      address: 'адрес из заказа',
      budget: 999999,
      tonyUpdatedAt: '2026-06-02 00:00:00',
    };

    await applyEvent(db, event, '169120', logisticsData('', tonyOrder), ctx());

    const row = storedRow();
    expect(String(row.budget)).toBe('450000');
    expect(row.department).toBe('Брендинг');
    expect(row.contact_email).toBe('old@example.com');
    expect(row.legal_entity).toBe('ООО Старое');
    expect(row.invoice_number).toBe('СЧ-100');
    expect(row.payment_amount).toBe(235752);
    expect(row.payment_status).toBe('PREDOPLATA');
    expect(row.address).toBe('адрес из заказа');
  });

  it('keeps stored line items when the act has no positions', async () => {
    insertStoredDeal('calendar');
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification)
      VALUES (1, 'Брендинг сукна на игровой стол', 16500, '1', 0, 'keyword_match')
    `).run();
    const event = toCalendarEvent(order, ...window);
    const descHtml = buildDescriptionHtml(order, []);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await applyEvent(db, event, '173157', {
      bookingNumbers: ['169120'],
      descHtml,
      calParsed: parseDealDescription(descHtml),
      calPayments: null,
      tonyOrders: new Map(),
    }, ctx());
    const names = db.prepare('SELECT name FROM deal_items WHERE deal_id = 1').all().map((row) => row.name);
    expect(names).toEqual(['Брендинг сукна на игровой стол']);
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toMatch(/173157/);
    expect(warn.mock.calls.map((call) => call.join(' ')).join('\n')).toMatch(/keeping 1 stored line items/);
    warn.mockRestore();
  });

  it('still writes budget, email, and legal entity when the description actually contains them', async () => {
    insertStoredDeal('calendar');
    const event = toCalendarEvent(order, ...window);
    const extra = `<p>E-Mail: new@example.com
Юр. Лицо: ООО Новое
№ cчета: СЧ-9
Бюджет: 1200 руб.
Скидка: 5%</p>`;
    await applyEvent(db, event, '169120', logisticsData(extra), ctx());
    const row = storedRow();
    expect(row.contact_email).toBe('new@example.com');
    expect(row.legal_entity).toBe('ООО Новое');
    expect(row.invoice_number).toBe('СЧ-9');
    expect(Number(row.budget)).toBe(1200);
    expect(row.discount).toBe('5%');
  });
});
