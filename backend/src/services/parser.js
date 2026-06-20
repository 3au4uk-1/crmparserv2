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
import { extractBookingNumbers } from './booking-numbers.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchTonyOrderHtml } from './tony-client.js';
import { parseTonyOrder } from './tony-parser.js';
import { buildTonyDealFields, buildTonyItems, tonyContentHash } from './tony-mapping.js';
import { planEventReconciliation } from './tony-reconcile.js';
import { createPool, withRetry } from './fetch-pool.js';

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

async function resolveTonyOrders(tonyReady, bookingNumbers) {
  const orders = new Map(); // bookingNumber -> parsed order
  if (!tonyReady) return orders;
  for (const n of bookingNumbers) {
    await delay(config.tonyRequestDelayMs);
    try {
      const html = await fetchTonyOrderHtml(n);
      if (html) orders.set(n, parseTonyOrder(html));
    } catch (err) {
      console.error(`[tony] failed to fetch order ${n}: ${err.message}`);
    }
  }
  return orders;
}

export async function fetchEventData(event, eventId, tonyReady) {
  await delay(350);

  let descJson;
  try {
    descJson = await fetchDescription(eventId);
  } catch (err) {
    console.error(`Failed to fetch description for event ${eventId}:`, err.message);
    return null;
  }

  const descHtml = typeof descJson === 'string'
    ? JSON.parse(descJson).description
    : descJson.description;

  if (!descHtml) return null;

  const bookingNumbers = extractBookingNumbers(event.title || '');
  const tonyOrders = await resolveTonyOrders(tonyReady, bookingNumbers);
  const calParsed = parseDealDescription(descHtml);

  return { bookingNumbers, descHtml, calParsed, tonyOrders };
}

/** Pooled, delay-free variant of resolveTonyOrders for the parallel pipeline. */
async function resolveTonyOrdersPooled(tonyReady, bookingNumbers, run) {
  const orders = new Map();
  if (!tonyReady) return orders;
  const retryRun = (fn) => run(() => withRetry(fn, {
    isRetryable: (e) => e.retryable || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT',
  }));
  await Promise.all(
    bookingNumbers.map(async (n) => {
      try {
        const html = await fetchTonyOrderHtml(n, { run: retryRun });
        if (html) orders.set(n, parseTonyOrder(html));
      } catch (err) {
        console.error(`[tony] failed to fetch order ${n}: ${err.message}`);
      }
    })
  );
  return orders;
}

/** Parallel prefetch of all in-range events' network data. Returns Map<eventId, data>. */
export async function prefetchAll(events, tonyReady, startDate, endDate, run) {
  const map = new Map();
  await Promise.all(
    events.map(async (event) => {
      if (!isEventInRange(event, startDate, endDate)) return;
      const eventId = String(event.original_id || event.id);
      if (!eventId) return;

      const bookingNumbers = extractBookingNumbers(event.title || '');

      let descJson;
      try {
        descJson = await run(() => withRetry(() => fetchDescription(eventId), {
          isRetryable: (e) => e.retryable || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT',
        }));
      } catch (err) {
        console.error(`Failed to fetch description for event ${eventId}:`, err.message);
        return;
      }
      const descHtml = typeof descJson === 'string'
        ? JSON.parse(descJson).description
        : descJson.description;
      if (!descHtml) return;

      const tonyOrders = await resolveTonyOrdersPooled(tonyReady, bookingNumbers, run);
      const calParsed = parseDealDescription(descHtml);

      map.set(eventId, { bookingNumbers, descHtml, calParsed, tonyOrders });
    })
  );
  return map;
}

async function applyEvent(db, event, eventId, data, ctx) {
  const { bookingNumbers, descHtml, calParsed, tonyOrders } = data;
  const { knownCodes, keywords, llmPrompt, counters, dealsToResync } = ctx;
  const titleInfo = parseDealTitle(event.title || '', knownCodes);
  const plan = planEventReconciliation(db, eventId, bookingNumbers);

  // Relink a lone calendar deal to a single new booking: change only its key/booking,
  // keeping its data_source so the per-target logic below decides the source.
  if (plan.relink) {
    db.prepare('UPDATE deals SET deal_key = ?, tony_order_id = ? WHERE id = ?')
      .run(plan.relink.newDealKey, plan.relink.bookingNumber, plan.relink.dealId);
  }

  const calContact = calParsed.contact;

  for (const target of plan.desired) {
    const existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(target.dealKey);
    const order = target.bookingNumber ? tonyOrders.get(target.bookingNumber) : undefined;

    if (order) {
      // Tony is the source of truth for this booking.
      if (order.items.length === 0) {
        console.warn(`[tony] order ${target.bookingNumber} has no parsed items, skipping update`);
        counters.skippedDeals++;
        continue;
      }
      const hash = tonyContentHash(order);
      if (existing && existing.content_hash === hash) { counters.skippedDeals++; continue; }

      const fields = buildTonyDealFields(order);
      const classifiedItems = await classifyItems(buildTonyItems(order), keywords, llmPrompt);

      if (existing) {
        const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;
        db.prepare(`
              UPDATE deals SET
                title = ?, company_code = ?, manager_name = ?,
                start_date = ?, end_date = ?, department = ?,
                contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
                address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
                load_date = ?, load_time = ?, budget = ?,
                content_hash = ?, data_source = 'tony', tony_order_id = ?, crm_lead_id = ?,
                twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END,
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName,
          fields.start_date, fields.end_date, event.department,
          calContact.name, calContact.email, calContact.company, calContact.phone,
          fields.address, fields.work_time, fields.arrival_time, fields.dismantle_time,
          fields.load_date, fields.load_time, fields.budget,
          hash, target.bookingNumber, event.leadid,
          wasCancelled ? 1 : 0, existing.id
        );
        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
        if (existing.twenty_id) dealsToResync.push(existing.id);
        counters.updatedDeals++;
      } else {
        const insert = db.prepare(`
              INSERT INTO deals (
                crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
                start_date, end_date, department, contact_name, contact_email, contact_company, contact_phone,
                address, work_time, arrival_time, dismantle_time, load_date, load_time, budget,
                tony_order_id, content_hash, raw_description
              ) VALUES (?, ?, 'tony', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
          eventId, target.dealKey, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
          fields.start_date, fields.end_date, event.department, calContact.name, calContact.email, calContact.company, calContact.phone,
          fields.address, fields.work_time, fields.arrival_time, fields.dismantle_time, fields.load_date, fields.load_time, fields.budget,
          target.bookingNumber, hash, descHtml
        );
        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }
        counters.newDeals++;
      }
    } else {
      // No Tony order for this target: title has no booking, or Tony unreachable/404.
      // Keep existing Tony-sourced data untouched during an outage (do not clobber with calendar).
      if (existing && existing.data_source === 'tony') { counters.skippedDeals++; continue; }

      const calTonyOrderId = target.bookingNumber || titleInfo.tonyOrderId || null;
      const hash = contentHash(descHtml);
      if (existing && existing.content_hash === hash) { counters.skippedDeals++; continue; }

      const parsed = calParsed;
      const classifiedItems = await classifyItems(parsed.items, keywords, llmPrompt);

      if (existing) {
        const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;
        db.prepare(`
              UPDATE deals SET
                title = ?, company_code = ?, manager_name = ?, start_date = ?, end_date = ?, department = ?,
                status = ?, legal_entity = ?, invoice_number = ?, budget = ?, discount = ?,
                contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
                address = ?, venue_type = ?, arrival_time = ?, ready_time = ?, work_time = ?, dismantle_time = ?,
                content_hash = ?, raw_description = ?, crm_lead_id = ?, tony_order_id = ?, data_source = 'calendar',
                twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END, updated_at = datetime('now')
              WHERE id = ?
            `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName, event.start, event.end, event.department,
          parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber, parsed.meta.budget, parsed.meta.discount,
          parsed.contact.name, parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType, parsed.event.arrivalTime || null, parsed.event.readyTime || null,
          parsed.event.workTime || null, parsed.event.dismantleTime || null,
          hash, descHtml, event.leadid, calTonyOrderId, wasCancelled ? 1 : 0, existing.id
        );
        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
        if (existing.twenty_id) dealsToResync.push(existing.id);
        counters.updatedDeals++;
      } else {
        const insert = db.prepare(`
              INSERT INTO deals (
                crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
                start_date, end_date, department, status, legal_entity, invoice_number, budget, discount,
                contact_name, contact_email, contact_company, contact_phone, address, venue_type,
                arrival_time, ready_time, work_time, dismantle_time, tony_order_id, content_hash, raw_description
              ) VALUES (?, ?, 'calendar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
          eventId, target.dealKey, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, event.department, parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber,
          parsed.meta.budget, parsed.meta.discount, parsed.contact.name, parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType, parsed.event.arrivalTime || null, parsed.event.readyTime || null,
          parsed.event.workTime || null, parsed.event.dismantleTime || null, calTonyOrderId, hash, descHtml
        );
        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }
        counters.newDeals++;
      }
    }
  }

  // Cancel deals whose booking was removed from the title. This is title-driven and reliable
  // even during a Tony outage (an outage does not change the title), so it is NOT gated on tonyReady.
  // Whole-event disappearance from the calendar is handled separately after the loop.
  for (const removeId of plan.removeDealIds) {
    const row = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(removeId);
    if (row && row.twenty_id) {
      try {
        const result = await cancelDealInTwenty(removeId);
        if (result && !result.skipped) counters.cancelledDeals++;
      } catch (err) {
        console.error(`[tony] cancel failed for deal ${removeId}: ${err.message}`);
      }
    }
  }
}

export async function runParsing(startDate, endDate) {
  const db = getDb();

  const run = db.prepare(
    'INSERT INTO parse_runs (status) VALUES (?)'
  ).run('running');
  const runId = run.lastInsertRowid;

  try {
    await authenticate();

    let tonyReady = false;
    const tonyCfg = getTonyConfig();
    if (tonyCfg.login && tonyCfg.password) {
      try {
        await tonyLogin();
        tonyReady = true;
      } catch (err) {
        console.warn(`[tony] login failed, falling back to calendar for this run: ${err.message}`);
      }
    }

    const events = (await fetchEvents(startDate, endDate)).sort((a, b) => {
      const da = parseEventDate(a.start ?? a.start_date)?.getTime() ?? 0;
      const db = parseEventDate(b.start ?? b.start_date)?.getTime() ?? 0;
      return da - db;
    });

    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const llmPrompt = getSetting('llm_prompt') || '';
    const knownCodes = loadCompanyCodes(db);

    const counters = { newDeals: 0, updatedDeals: 0, skippedDeals: 0, cancelledDeals: 0 };
    let outOfRange = 0;
    const dealsToResync = [];
    const ctx = { knownCodes, keywords, llmPrompt, counters, dealsToResync };

    let prefetched = null;
    if (config.parsePipeline === 'parallel') {
      const run = createPool({ concurrency: config.fetchConcurrency });
      console.log(`[parse] prefetch start {"pipeline":"parallel","concurrency":${config.fetchConcurrency}}`);
      const t0 = Date.now();
      prefetched = await prefetchAll(events, tonyReady, startDate, endDate, run);
      console.log(`[parse] prefetch done {"events":${prefetched.size},"ms":${Date.now() - t0}}`);
    }

    for (const event of events) {
      if (!isEventInRange(event, startDate, endDate)) {
        outOfRange++;
        continue;
      }

      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      const data = prefetched
        ? prefetched.get(eventId)
        : await fetchEventData(event, eventId, tonyReady);
      if (!data) continue;

      await applyEvent(db, event, eventId, data, ctx);
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
    `).run(inRangeCount, counters.newDeals, counters.updatedDeals, counters.skippedDeals, runId);

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
        if (result && !result.skipped) counters.cancelledDeals++;
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
      newDeals: counters.newDeals,
      updatedDeals: counters.updatedDeals,
      skippedDeals: counters.skippedDeals,
      cancelledDeals: counters.cancelledDeals,
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
