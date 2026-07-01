import { getDb } from '../db/connection.js';
import { authenticate } from './auth.js';
import { fetchEvents } from './parser.js';
import { parseDealTitle } from './title-parser.js';
import { loadCompanyCodes } from './companies.js';
import { parseEventDate, toInputDate } from '../utils/crm-dates.js';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Refresh deal title/company/manager from the linked calendar event (if found).
 * Keeps existing values when the event is outside the fetch window or missing.
 */
export async function refreshDealCalendarMetadata(dealId) {
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal?.crm_event_id || deal.crm_event_id === 'import') {
    return deal;
  }

  await authenticate();
  const anchor = parseEventDate(deal.start_date) || new Date();
  const events = await fetchEvents(
    toInputDate(addDays(anchor, -14)),
    toInputDate(addDays(anchor, 14)),
  );
  const eventId = String(deal.crm_event_id);
  const event = events.find((e) => String(e.original_id || e.id || '') === eventId);
  if (!event?.title) {
    return deal;
  }

  const knownCodes = loadCompanyCodes(db);
  const titleInfo = parseDealTitle(event.title, knownCodes);

  db.prepare(`
    UPDATE deals SET
      title = ?,
      company_code = ?,
      manager_name = ?,
      crm_lead_id = COALESCE(?, crm_lead_id),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    event.title,
    titleInfo.companyCode || deal.company_code,
    titleInfo.managerName || deal.manager_name,
    event.leadid ?? deal.crm_lead_id,
    dealId,
  );

  return db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
}
