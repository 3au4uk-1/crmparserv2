import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { authenticate, getCalToken, getCrmRequestHeaders } from './auth.js';
import { parseDealDescription } from './html-parser.js';
import { parseDealTitle } from './title-parser.js';
import { loadCompanyCodes } from './companies.js';
import { classifyItems } from './classifier.js';
import { formatCrmDateTime, isEventInRange, parseEventDate } from '../utils/crm-dates.js';
import { syncDealToTwenty, cancelDealInTwenty } from './twenty-sync.js';
import { processAutoApprovals } from './auto-approve.js';
import { buildOverrideMap, replaceDealItemsPreservingOverrides } from './deal-items-update.js';
import {
  collectCalendarEventIds,
  findDealsMissingFromCalendar,
} from './calendar-missing.js';
import { CANCELLED_OPPORTUNITY_STAGE } from './twenty-opportunity.js';

function buildUrl(path) {
  const base = config.crmBaseUrl.replace(/\/$/, '');
  return `${base}/${path}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function contentHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function normalizeEventsResponse(data) {
  if (Array.isArray(data)) return data;

  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
    if (trimmed.startsWith('<')) {
      throw new Error(
        'CRM returned HTML instead of events JSON. Session may be invalid — refresh PHPSESSID cookies.'
      );
    }
  }

  throw new Error(`CRM returned unexpected events format: ${typeof data}`);
}

async function fetchEvents(startDate, endDate) {
  const token = getCalToken();
  const start = formatCrmDateTime(startDate);
  const end = formatCrmDateTime(endDate);
  const url = buildUrl(
    `includes/cal_events.php?token=${encodeURIComponent(token)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );

  const resp = await axios.get(url, {
    headers: {
      ...getCrmRequestHeaders(),
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
    timeout: 30000,
  });

  return normalizeEventsResponse(resp.data);
}

async function fetchDescription(eventId) {
  const url = buildUrl('includes/cal_description.php');

  const resp = await axios.post(
    url,
    new URLSearchParams({
      id: eventId,
      mode: 'edit',
    }).toString(),
    {
      headers: {
        ...getCrmRequestHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    }
  );

  return resp.data;
}

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

export async function runParsing(startDate, endDate) {
  const db = getDb();

  const run = db.prepare(
    'INSERT INTO parse_runs (status) VALUES (?)'
  ).run('running');
  const runId = run.lastInsertRowid;

  try {
    await authenticate();

    const events = (await fetchEvents(startDate, endDate)).sort((a, b) => {
      const da = parseEventDate(a.start ?? a.start_date)?.getTime() ?? 0;
      const db = parseEventDate(b.start ?? b.start_date)?.getTime() ?? 0;
      return da - db;
    });

    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const llmPrompt = getSetting('llm_prompt') || '';
    const knownCodes = loadCompanyCodes(db);

    let newDeals = 0;
    let updatedDeals = 0;
    let skippedDeals = 0;
    let outOfRange = 0;
    const dealsToResync = [];

    for (const event of events) {
      if (!isEventInRange(event, startDate, endDate)) {
        outOfRange++;
        continue;
      }

      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      await delay(350);

      let descJson;
      try {
        descJson = await fetchDescription(eventId);
      } catch (err) {
        console.error(`Failed to fetch description for event ${eventId}:`, err.message);
        continue;
      }

      const descHtml = typeof descJson === 'string'
        ? JSON.parse(descJson).description
        : descJson.description;

      if (!descHtml) continue;

      const hash = contentHash(descHtml);

      const existing = db.prepare(
        'SELECT id, content_hash, twenty_id FROM deals WHERE crm_event_id = ?'
      ).get(eventId);

      if (existing && existing.content_hash === hash) {
        skippedDeals++;
        continue;
      }

      const parsed = parseDealDescription(descHtml);
      const titleInfo = parseDealTitle(event.title || '', knownCodes);

      const classifiedItems = await classifyItems(parsed.items, keywords, llmPrompt);

      if (existing) {
        const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;

        db.prepare(`
          UPDATE deals SET
            title = ?, company_code = ?, manager_name = ?,
            start_date = ?, end_date = ?, department = ?,
            status = ?, legal_entity = ?, invoice_number = ?,
            budget = ?, discount = ?, contact_name = ?,
            contact_email = ?, contact_company = ?, contact_phone = ?,
            address = ?, venue_type = ?,
            arrival_time = ?, ready_time = ?, work_time = ?, dismantle_time = ?,
            content_hash = ?,
            raw_description = ?, crm_lead_id = ?, tony_order_id = ?,
            twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, event.department,
          parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber,
          parsed.meta.budget, parsed.meta.discount, parsed.contact.name,
          parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType,
          parsed.event.arrivalTime || null, parsed.event.readyTime || null,
          parsed.event.workTime || null, parsed.event.dismantleTime || null,
          hash,
          descHtml, event.leadid, titleInfo.tonyOrderId || null,
          wasCancelled ? 1 : 0,
          existing.id
        );

        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        const overrideMap = buildOverrideMap(existingItems);
        replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, overrideMap);

        if (existing.twenty_id) {
          dealsToResync.push(existing.id);
        }

        updatedDeals++;
      } else {
        const insert = db.prepare(`
          INSERT INTO deals (
            crm_event_id, crm_lead_id, title, company_code, manager_name,
            start_date, end_date, department, status, legal_entity,
            invoice_number, budget, discount, contact_name, contact_email,
            contact_company, contact_phone, address, venue_type,
            arrival_time, ready_time, work_time, dismantle_time,
            tony_order_id, content_hash, raw_description
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, event.department, parsed.meta.status, parsed.meta.legalEntity,
          parsed.meta.invoiceNumber, parsed.meta.budget, parsed.meta.discount, parsed.contact.name,
          parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType,
          parsed.event.arrivalTime || null, parsed.event.readyTime || null,
          parsed.event.workTime || null, parsed.event.dismantleTime || null,
          titleInfo.tonyOrderId || null, hash, descHtml
        );

        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`
            INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }

        newDeals++;
      }
    }

    const inRangeCount = events.length - outOfRange;
    if (inRangeCount === 0) {
      console.warn(
        `CRM returned 0 in-range events for ${formatCrmDateTime(startDate)} → ${formatCrmDateTime(endDate)}` +
          (outOfRange > 0 ? ` (${outOfRange} outside range skipped)` : '')
      );
    } else if (outOfRange > 0) {
      console.log(`Skipped ${outOfRange} events outside parse range`);
    }

    db.prepare(`
      UPDATE parse_runs SET
        finished_at = datetime('now'), status = 'completed',
        total_events = ?, new_deals = ?, updated_deals = ?, skipped_deals = ?
      WHERE id = ?
    `).run(inRangeCount, newDeals, updatedDeals, skippedDeals, runId);

    if (dealsToResync.length > 0) {
      console.log(`[twenty-sync] ${new Date().toISOString()} parse.resync_queue {"count":${dealsToResync.length},"dealIds":${JSON.stringify(dealsToResync)}}`);
    }

    for (let i = 0; i < dealsToResync.length; i++) {
      const dealId = dealsToResync[i];
      if (i > 0) await delay(1000);
      console.log(`[twenty-sync] ${new Date().toISOString()} parse.resync_start {"dealId":${dealId},"index":${i + 1},"total":${dealsToResync.length}}`);
      try {
        await syncDealToTwenty(dealId);
        console.log(`[twenty-sync] ${new Date().toISOString()} parse.resync_done {"dealId":${dealId}}`);
      } catch (err) {
        console.error(`[twenty-sync] ${new Date().toISOString()} parse.resync_failed {"dealId":${dealId},"error":${JSON.stringify(err.message)}}`);
      }
    }

    const calendarEventIds = collectCalendarEventIds(events, startDate, endDate);
    const missingDeals = findDealsMissingFromCalendar(db, calendarEventIds, startDate, endDate);
    let cancelledDeals = 0;

    if (missingDeals.length > 0) {
      console.log(
        `[twenty-sync] ${new Date().toISOString()} parse.cancel_queue {"count":${missingDeals.length},"dealIds":${JSON.stringify(missingDeals.map((d) => d.id))}}`
      );
    }

    for (let i = 0; i < missingDeals.length; i++) {
      const deal = missingDeals[i];
      if (i > 0) await delay(1000);
      console.log(
        `[twenty-sync] ${new Date().toISOString()} parse.cancel_start {"dealId":${deal.id},"crmEventId":${JSON.stringify(deal.crm_event_id)},"index":${i + 1},"total":${missingDeals.length}}`
      );
      try {
        const result = await cancelDealInTwenty(deal.id);
        if (result && !result.skipped) cancelledDeals++;
        console.log(`[twenty-sync] ${new Date().toISOString()} parse.cancel_done {"dealId":${deal.id}}`);
      } catch (err) {
        console.error(
          `[twenty-sync] ${new Date().toISOString()} parse.cancel_failed {"dealId":${deal.id},"error":${JSON.stringify(err.message)}}`
        );
      }
    }

    const autoApprove = await processAutoApprovals();

    return {
      runId,
      total: inRangeCount,
      newDeals,
      updatedDeals,
      skippedDeals,
      cancelledDeals,
      outOfRange,
      autoApprove,
    };
  } catch (err) {
    db.prepare(`
      UPDATE parse_runs SET finished_at = datetime('now'), status = 'failed', error = ? WHERE id = ?
    `).run(err.message, runId);
    throw err;
  }
}
