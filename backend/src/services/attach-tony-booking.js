import { getDb } from '../db/connection.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchTonyOrderHtml } from './tony-client.js';
import { parseTonyOrder } from './tony-parser.js';
import {
  buildTonyDealFields,
  buildTonyItems,
  tonyContentHash,
} from './tony-mapping.js';
import { classifyItems } from './classifier.js';
import { bookingDealKey } from './deal-keys.js';
import {
  buildOverrideMap,
  replaceDealItemsPreservingOverrides,
} from './deal-items-update.js';
import { resyncDealIfSynced } from './twenty-sync.js';
import { refreshDealCalendarMetadata } from './calendar-deal-metadata.js';

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

async function ensureTonyReady() {
  const { login, password, baseUrl } = getTonyConfig();
  if (!baseUrl) throw Object.assign(new Error('Tony not configured'), { status: 500 });
  if (!login || !password) {
    throw Object.assign(new Error('Tony credentials not configured'), { status: 500 });
  }
  await tonyLogin();
}

export async function attachTonyBooking(dealId, bookingNumber) {
  if (!/^\d+$/.test(bookingNumber)) {
    throw Object.assign(new Error('bookingNumber must contain only digits'), { status: 400 });
  }

  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw Object.assign(new Error('Deal not found'), { status: 404 });

  const targetKey = bookingDealKey(bookingNumber);
  const conflict = db.prepare('SELECT id FROM deals WHERE deal_key = ? AND id != ?').get(targetKey, dealId);
  if (conflict) {
    throw Object.assign(new Error('Бронь уже привязана к другой сделке'), { status: 409 });
  }

  await ensureTonyReady();
  const tonyHtml = await fetchTonyOrderHtml(bookingNumber);
  if (!tonyHtml) throw Object.assign(new Error('Бронь не найдена'), { status: 404 });

  const order = parseTonyOrder(tonyHtml);
  if (!order?.items?.length) {
    throw Object.assign(new Error('Нет позиций в заказе Tony'), { status: 404 });
  }

  const keywords = JSON.parse(getSetting('keywords') || '[]');
  const classifiedItems = await classifyItems(
    buildTonyItems(order),
    keywords,
    getSetting('llm_prompt'),
  );
  const fields = buildTonyDealFields(order);
  const hash = tonyContentHash(order);

  const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const overrideMap = buildOverrideMap(existingItems);
  const calendarTitle = deal.title;
  const calendarCompany = deal.company_code;
  const calendarManager = deal.manager_name;

  db.prepare(`
    UPDATE deals SET
      tony_order_id = ?,
      deal_key = ?,
      data_source = 'tony',
      title = ?,
      company_code = ?,
      manager_name = ?,
      address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
      load_date = ?, load_time = ?, budget = ?,
      start_date = ?, end_date = ?,
      content_hash = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    bookingNumber,
    targetKey,
    calendarTitle,
    calendarCompany,
    calendarManager,
    fields.address,
    fields.work_time,
    fields.arrival_time,
    fields.dismantle_time,
    fields.load_date,
    fields.load_time,
    fields.budget,
    fields.start_date,
    fields.end_date,
    hash,
    dealId,
  );

  replaceDealItemsPreservingOverrides(db, dealId, classifiedItems, overrideMap);

  try {
    await refreshDealCalendarMetadata(dealId);
  } catch (err) {
    console.warn(`[attach-tony-booking] calendar metadata refresh failed for deal ${dealId}: ${err.message}`);
  }

  const sync = await resyncDealIfSynced(dealId);
  const itemCount = db.prepare('SELECT COUNT(*) AS c FROM deal_items WHERE deal_id = ?').get(dealId).c;

  return {
    success: true,
    dealId,
    bookingNumber,
    itemCount,
    sync,
  };
}
