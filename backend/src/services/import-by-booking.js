import { getDb } from '../db/connection.js';
import { fetchEventData, applyEvent } from './parser.js';
import { findCalendarEventsByBooking } from './calendar-lookup.js';
import { findTwentyOpportunityIdByBooking } from './twenty-lookup.js';
import { fetchTonyOrderHtml } from './tony-client.js';
import { parseTonyOrder } from './tony-parser.js';
import { buildTonyDealFields, buildTonyItems, tonyContentHash } from './tony-mapping.js';
import { classifyItems } from './classifier.js';
import { loadCompanyCodes } from './companies.js';
import { syncDealToTwenty } from './twenty-sync.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { getItemsForTwenty } from './twenty-items.js';
import { loadBlacklist } from './blacklist.js';

const IMPORT_EVENT_ID = 'import';

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

async function ensureTonyReady() {
  const { login, password, baseUrl } = getTonyConfig();
  if (!baseUrl) throw new Error('Tony not configured');
  if (!login || !password) throw new Error('Tony credentials not configured');
  await tonyLogin();
}

function replaceDealItems(db, dealId, classifiedItems) {
  db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(dealId);
  for (const item of classifiedItems) {
    db.prepare(
      `INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence, comment, sum, quantity_num)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      dealId,
      item.name,
      item.price,
      item.quantity,
      item.discount,
      item.classification,
      item.classification_confidence,
      item.comment ?? null,
      item.sum ?? null,
      item.quantity_num ?? null,
    );
  }
}

async function persistSyntheticTonyDeal(db, bookingNumber, order, classifiedItems) {
  const fields = buildTonyDealFields(order);
  const hash = tonyContentHash(order);
  const dealKey = `import#${bookingNumber}`;

  const existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(dealKey);
  if (existing) {
    db.prepare(`
      UPDATE deals SET
        title = ?, start_date = ?, end_date = ?,
        address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
        load_date = ?, load_time = ?, budget = ?,
        content_hash = ?, data_source = 'tony', tony_order_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      `Бронь №${bookingNumber}`,
      fields.start_date,
      fields.end_date,
      fields.address,
      fields.work_time,
      fields.arrival_time,
      fields.dismantle_time,
      fields.load_date,
      fields.load_time,
      fields.budget,
      hash,
      bookingNumber,
      existing.id,
    );
    replaceDealItems(db, existing.id, classifiedItems);
    return existing.id;
  }

  const insert = db.prepare(`
    INSERT INTO deals (
      crm_event_id, deal_key, data_source, title, company_code, manager_name,
      start_date, end_date, address, work_time, arrival_time, dismantle_time,
      load_date, load_time, budget, tony_order_id, content_hash, raw_description
    ) VALUES (?, ?, 'tony', ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `).run(
    IMPORT_EVENT_ID,
    dealKey,
    `Бронь №${bookingNumber}`,
    fields.start_date,
    fields.end_date,
    fields.address,
    fields.work_time,
    fields.arrival_time,
    fields.dismantle_time,
    fields.load_date,
    fields.load_time,
    fields.budget,
    bookingNumber,
    hash,
  );
  const dealId = insert.lastInsertRowid;
  replaceDealItems(db, dealId, classifiedItems);
  return dealId;
}

async function adoptTwentyIdIfExists(db, dealId, bookingNumber) {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (deal?.twenty_id) return deal.twenty_id;

  const twentyId = await findTwentyOpportunityIdByBooking(bookingNumber);
  if (twentyId) {
    db.prepare(
      `UPDATE deals SET twenty_id = ?, approval_status = COALESCE(approval_status, 'synced') WHERE id = ?`,
    ).run(twentyId, dealId);
  }
  return twentyId;
}

export async function importDealByBooking(bookingNumber) {
  if (!/^\d+$/.test(bookingNumber)) {
    throw new Error('bookingNumber must contain only digits');
  }

  const db = getDb();

  const existing = db.prepare('SELECT * FROM deals WHERE tony_order_id = ?').get(bookingNumber);
  if (existing?.twenty_id) {
    return { ok: true, opportunityId: existing.twenty_id, dealId: existing.id };
  }

  await ensureTonyReady();

  const calendarEvents = await findCalendarEventsByBooking(bookingNumber);
  let dealId = existing?.id ?? null;

  if (calendarEvents.length > 0) {
    const event = calendarEvents[0];
    const eventId = String(event.id ?? event.ID);
    const data = await fetchEventData(event, eventId, true);
    const knownCodes = loadCompanyCodes(db);
    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const ctx = {
      knownCodes,
      keywords,
      llmPrompt: getSetting('llm_prompt'),
      counters: { newDeals: 0, updatedDeals: 0, skippedDeals: 0 },
      dealsToResync: [],
    };
    await applyEvent(db, event, eventId, data, ctx);
    const row = db.prepare('SELECT * FROM deals WHERE tony_order_id = ?').get(bookingNumber);
    if (!row) throw new Error('Бронь не найдена');
    dealId = row.id;
  } else {
    const html = await fetchTonyOrderHtml(bookingNumber);
    if (!html) throw new Error('Бронь не найдена');

    const order = parseTonyOrder(html);
    if (!order?.items?.length) throw new Error('Нет позиций в заказе Tony');

    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const classifiedItems = await classifyItems(
      buildTonyItems(order),
      keywords,
      getSetting('llm_prompt'),
    );
    dealId = await persistSyntheticTonyDeal(db, bookingNumber, order, classifiedItems);
  }

  await adoptTwentyIdIfExists(db, dealId, bookingNumber);

  const items = getItemsForTwenty(
    db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId),
    loadBlacklist(db),
  );
  if (items.length === 0) {
    throw new Error('Нет брендинговых позиций для переноса в Twenty');
  }

  const syncResult = await syncDealToTwenty(dealId);
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);

  return {
    ok: true,
    opportunityId: syncResult.twentyId ?? deal.twenty_id,
    dealId,
  };
}
