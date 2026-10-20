import crypto from 'crypto';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { authenticate } from './auth.js';
import { fetchLogisticDescription, fetchLogisticEvents } from './logistics-source.js';
import { parseDealDescription } from './html-parser.js';
import { parseDealTitle } from './title-parser.js';
import { loadCompanyCodes } from './companies.js';
import { classifyItems } from './classifier.js';
import { formatCrmDateTime, isEventInRange, parseEventDate } from '../utils/crm-dates.js';
import { cancelDealInTwenty } from './twenty-sync.js';
import { collectAutoApproveDealIds } from './auto-approve.js';
import { runPostParseTwentySync } from './post-parse-twenty-sync.js';
import { buildOverrideMap, replaceDealItemsPreservingOverrides } from './deal-items-update.js';
import {
  collectCalendarEventIds,
  collectCalendarBookingNumbers,
  collectDealsReadyToCancelFromCalendar,
  findCancelledDealsBackInCalendar,
} from './calendar-missing.js';
import { extractBookingNumbers } from './booking-numbers.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchTonyOrderHtml, fetchTonyOrderInfo } from './tony-client.js';
import { parseTonyOrder } from './tony-parser.js';
import { shouldSkipTonyFullFetch, loadTonyUpdatedAtMap, persistTonyUpdatedAt } from './tony-unchanged.js';
import { buildTonyDealFields, buildTonyItems, tonyContentHash } from './tony-mapping.js';
import { planEventReconciliation } from './tony-reconcile.js';
import {
  inferBitrixLinkRole,
  upsertDealBitrixLink,
  listDealBitrixLinks,
  mirrorCanonicalCrmLeadId,
} from './deal-bitrix-links.js';
import { createPool, withRetry } from './fetch-pool.js';
import { parseCalendarPayments, paymentContentHash, applyPaymentAggregateToDb, calendarPaymentsProvided } from './payment-parser.js';
import { PAYMENT_STATUS } from './payment-field-names.js';

/** Empty/missing Tony order should not skip the booking — fall back to calendar write. */
export function useCalendarFallbackForTonyOrder(order) {
  return !order || !Array.isArray(order.items) || order.items.length === 0;
}

export function attachEventBitrixLink(db, dealId, { leadId, title, paymentAmount }) {
  if (!leadId || !String(leadId).trim()) return;
  const deal = db.prepare('SELECT payment_amount FROM deals WHERE id = ?').get(dealId);
  upsertDealBitrixLink(db, {
    dealId,
    bitrixId: String(leadId).trim(),
    role: inferBitrixLinkRole({
      eventTitle: title,
      paymentAmount: paymentAmount ?? deal?.payment_amount ?? 0,
    }),
  });
  const links = listDealBitrixLinks(db, dealId);
  const locked = links.some((l) => l.isCanonical);
  if (!locked) {
    // first link already canonical via upsert; nothing else
  }
  mirrorCanonicalCrmLeadId(db, dealId);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function contentHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export async function fetchEvents(startDate, endDate) {
  return fetchLogisticEvents(startDate, endDate);
}

export async function fetchDescription(eventId) {
  return fetchLogisticDescription(eventId);
}

export function parseDescriptionResponse(data) {
  const json = typeof data === 'string' ? JSON.parse(data) : data;
  return {
    descHtml: json?.description || '',
    calPayments: json?.payments || null,
    paymentStatus: json?.paymentStatus || null,
  };
}

/** Blank, null, and undefined mean the source did not send the field. Keep the stored value. */
export function keepStored(next, existing) {
  if (next == null) return existing ?? null;
  if (typeof next === 'string' && next.trim() === '') return existing ?? null;
  return next;
}

function persistDealPayments(db, dealId, calPayments, existing, dealsToResync) {
  if (!calendarPaymentsProvided(calPayments)) return false;
  const aggregate = parseCalendarPayments(calPayments);
  const hash = paymentContentHash(aggregate);
  if (existing?.payment_hash === hash) return false;

  applyPaymentAggregateToDb(db, dealId, aggregate);

  if (existing?.twenty_id && !dealsToResync.includes(dealId)) {
    dealsToResync.push(dealId);
  }
  return true;
}

const TONY_PAYMENT_STATUSES = new Set(Object.values(PAYMENT_STATUS));

/** Badge status only. Amount, count, and hash stay with payment history. */
function applyTonyPaymentStatus(db, dealId, paymentStatus, dealsToResync) {
  if (!paymentStatus || !TONY_PAYMENT_STATUSES.has(paymentStatus)) return false;
  const row = db.prepare('SELECT payment_status, twenty_id FROM deals WHERE id = ?').get(dealId);
  if (!row || row.payment_status === paymentStatus) return false;
  db.prepare(`
    UPDATE deals SET payment_status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(paymentStatus, dealId);
  if (row.twenty_id && !dealsToResync.includes(dealId)) dealsToResync.push(dealId);
  return true;
}

function finishUnchangedDeal(db, dealId, calPayments, existing, paymentStatus, dealsToResync, counters) {
  const paymentsChanged = persistDealPayments(db, dealId, calPayments, existing, dealsToResync);
  const statusChanged = applyTonyPaymentStatus(db, dealId, paymentStatus, dealsToResync);
  if (!paymentsChanged && !statusChanged) counters.skippedDeals++;
  else if (statusChanged) counters.updatedDeals++;
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

  const { descHtml, calPayments, paymentStatus } = parseDescriptionResponse(descJson);

  if (!descHtml) return null;

  const bookingNumbers = extractBookingNumbers(event.title || '');
  const tonyOrders = await resolveTonyOrders(tonyReady, bookingNumbers);
  const calParsed = parseDealDescription(descHtml);

  return { bookingNumbers, descHtml, calParsed, calPayments, paymentStatus, tonyOrders };
}

/** Pooled, delay-free variant of resolveTonyOrders for the parallel pipeline. */
async function resolveTonyOrdersPooled(tonyReady, bookingNumbers, run, {
  stamps = new Map(),
  probeEnabled = false,
  stats = null,
} = {}) {
  const orders = new Map();
  if (!tonyReady) return orders;
  const retryRun = (fn) => run(() => withRetry(fn, {
    isRetryable: (e) => e.retryable || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT',
  }));
  await Promise.all(
    bookingNumbers.map(async (n) => {
      let probe = null;
      if (probeEnabled) {
        try {
          probe = await fetchTonyOrderInfo(n, { run: retryRun });
          if (stats && probe.ok) stats.tony_probe++;
        } catch (err) {
          console.error(`[tony] probe failed for order ${n}: ${err.message}`);
          if (stats) stats.tony_probe_fail++;
          return;
        }
        if (!probe.ok || probe.notFound || probe.deleted) {
          if (!probe.ok && !probe.notFound && !probe.deleted) {
            console.error(`[tony] probe returned no usable data for order ${n}`);
            if (stats) stats.tony_probe_fail++;
          }
          return;
        }
        const known = stamps.get(String(n));
        if (shouldSkipTonyFullFetch({
          probeEnabled: true,
          probe,
          existingStamp: known?.stamp ?? null,
          dataSource: known?.dataSource ?? null,
        })) {
          if (stats) stats.tony_skip++;
          return;
        }
      }
      try {
        const html = await fetchTonyOrderHtml(n, { run: retryRun });
        if (html) {
          const parsed = parseTonyOrder(html);
          if (probe?.updatedAt) parsed.tonyUpdatedAt = probe.updatedAt;
          orders.set(n, parsed);
          if (stats) stats.tony_full++;
        }
      } catch (err) {
        console.error(`[tony] failed to fetch order ${n}: ${err.message}`);
      }
    })
  );
  return orders;
}

/** Parallel prefetch of in-range events' network data. Returns Map<eventId, data>. */
export async function prefetchAll(events, tonyReady, startDate, endDate, run, options) {
  const map = new Map();
  let done = 0;
  const total = events.length;

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
      const { descHtml, calPayments, paymentStatus } = parseDescriptionResponse(descJson);
      if (!descHtml) return;

      const tonyOrders = await resolveTonyOrdersPooled(tonyReady, bookingNumbers, run, options);
      const calParsed = parseDealDescription(descHtml);

      map.set(eventId, { bookingNumbers, descHtml, calParsed, calPayments, paymentStatus, tonyOrders });

      done++;
      if (done % 25 === 0 || done === total) {
        console.log(`[parse] prefetch progress {"done":${done},"total":${total},"loaded":${map.size}}`);
      }
    })
  );
  return map;
}

/** Mark orphaned parse runs as failed after an unclean server stop. */
export function recoverStaleParseRuns(db) {
  const result = db.prepare(`
    UPDATE parse_runs
    SET status = 'failed', finished_at = datetime('now'), error = ?
    WHERE status = 'running'
  `).run('Interrupted: server restarted while parse was in progress');
  if (result.changes > 0) {
    console.warn(`[parse] marked ${result.changes} stale parse run(s) as failed`);
  }
}

export async function applyEvent(db, event, eventId, data, ctx) {
  const { bookingNumbers, descHtml, calParsed, calPayments, paymentStatus, tonyOrders } = data;
  const { knownCodes, keywords, llmPrompt, counters, dealsToResync } = ctx;
  const titleInfo = parseDealTitle(event.title || '', knownCodes);
  const plan = planEventReconciliation(db, eventId, bookingNumbers);
  const paymentsKnown = calendarPaymentsProvided(calPayments);
  const paymentAggregate = paymentsKnown ? parseCalendarPayments(calPayments) : null;
  const paymentHash = paymentsKnown ? paymentContentHash(paymentAggregate) : null;
  const paymentValues = (row) => (
    paymentsKnown
      ? [paymentAggregate.paymentAmount, paymentAggregate.paymentStatus, paymentAggregate.paymentCount, paymentHash]
      : [row?.payment_amount ?? null, row?.payment_status ?? null, row?.payment_count ?? null, row?.payment_hash ?? null]
  );
  const linkPaymentAmount = paymentsKnown ? paymentAggregate.paymentAmount : undefined;

  // Relink a lone calendar deal to a single new booking: change only its key/booking,
  // keeping its data_source so the per-target logic below decides the source.
  if (plan.relink) {
    db.prepare('UPDATE deals SET deal_key = ?, tony_order_id = ? WHERE id = ?')
      .run(plan.relink.newDealKey, plan.relink.bookingNumber, plan.relink.dealId);
  }

  const calContact = calParsed.contact;

  for (const target of plan.desired) {
    const existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(target.dealKey);
    let order = target.bookingNumber ? tonyOrders.get(target.bookingNumber) : undefined;
    const emptyTonyItems = Boolean(order && Array.isArray(order.items) && order.items.length === 0);
    if (emptyTonyItems) {
      console.warn(`[tony] order ${target.bookingNumber} has no parsed items, using calendar fallback`);
      order = undefined;
    }

    if (order) {
      // Tony is the source of truth for this booking.
      const hash = tonyContentHash(order);
      if (existing && existing.content_hash === hash) {
        persistTonyUpdatedAt(db, existing.id, order.tonyUpdatedAt);
        attachEventBitrixLink(db, existing.id, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        finishUnchangedDeal(db, existing.id, calPayments, existing, paymentStatus, dealsToResync, counters);
        continue;
      }

      const fields = buildTonyDealFields(order);
      const classifiedItems = await classifyItems(buildTonyItems(order), keywords, llmPrompt);

      if (existing) {
        const hasCanonical = listDealBitrixLinks(db, existing.id).some((l) => l.isCanonical);
        db.prepare(`
              UPDATE deals SET
                title = ?, company_code = ?, manager_name = ?,
                start_date = ?, end_date = ?, department = ?,
                contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
                address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
                load_date = ?, load_time = ?, budget = ?,
                content_hash = ?, tony_updated_at = ?, data_source = 'tony', tony_order_id = ?, crm_lead_id = ?,
                payment_amount = ?, payment_status = ?, payment_count = ?, payment_hash = ?,
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName,
          keepStored(fields.start_date, existing.start_date),
          keepStored(fields.end_date, existing.end_date),
          keepStored(event.department, existing.department),
          keepStored(calContact.name, existing.contact_name),
          keepStored(calContact.email, existing.contact_email),
          keepStored(calContact.company, existing.contact_company),
          keepStored(calContact.phone, existing.contact_phone),
          keepStored(fields.address, existing.address),
          keepStored(fields.work_time, existing.work_time),
          keepStored(fields.arrival_time, existing.arrival_time),
          keepStored(fields.dismantle_time, existing.dismantle_time),
          keepStored(fields.load_date, existing.load_date),
          keepStored(fields.load_time, existing.load_time),
          keepStored(calParsed.meta?.budget, existing.budget),
          hash, order.tonyUpdatedAt ?? null, target.bookingNumber,
          hasCanonical ? existing.crm_lead_id : keepStored(event.leadid, existing.crm_lead_id),
          ...paymentValues(existing),
          existing.id
        );
        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
        attachEventBitrixLink(db, existing.id, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        if (existing.twenty_id && !dealsToResync.includes(existing.id)) dealsToResync.push(existing.id);
        applyTonyPaymentStatus(db, existing.id, paymentStatus, dealsToResync);
        counters.updatedDeals++;
      } else {
        const insert = db.prepare(`
              INSERT INTO deals (
                crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
                start_date, end_date, department, contact_name, contact_email, contact_company, contact_phone,
                address, work_time, arrival_time, dismantle_time, load_date, load_time, budget,
                tony_order_id, content_hash, tony_updated_at, raw_description,
                payment_amount, payment_status, payment_count, payment_hash
              ) VALUES (?, ?, 'tony', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
          eventId, target.dealKey, null, event.title, titleInfo.companyCode, titleInfo.managerName,
          keepStored(fields.start_date, null), keepStored(fields.end_date, null), keepStored(event.department, null),
          keepStored(calContact.name, null), keepStored(calContact.email, null), keepStored(calContact.company, null), keepStored(calContact.phone, null),
          keepStored(fields.address, null), keepStored(fields.work_time, null), keepStored(fields.arrival_time, null), keepStored(fields.dismantle_time, null),
          keepStored(fields.load_date, null), keepStored(fields.load_time, null), keepStored(calParsed.meta?.budget, null),
          target.bookingNumber, hash, order.tonyUpdatedAt ?? null, descHtml,
          ...paymentValues(null)
        );
        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence, comment, sum, quantity_num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence, item.comment ?? null, item.sum ?? null, item.quantity_num ?? null);
        }
        attachEventBitrixLink(db, dealId, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        applyTonyPaymentStatus(db, dealId, paymentStatus, dealsToResync);
        counters.newDeals++;
      }
    } else {
      // No Tony order for this target: title has no booking, Tony unreachable/404, or empty items.
      // Keep existing Tony-sourced data untouched during an outage (do not clobber with calendar),
      // but empty Tony items intentionally fall through to calendar write.
      if (existing && existing.data_source === 'tony' && !emptyTonyItems) {
        attachEventBitrixLink(db, existing.id, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        finishUnchangedDeal(db, existing.id, calPayments, existing, paymentStatus, dealsToResync, counters);
        continue;
      }

      const calTonyOrderId = target.bookingNumber || titleInfo.tonyOrderId || null;
      const hash = contentHash(descHtml);
      if (existing && existing.content_hash === hash) {
        attachEventBitrixLink(db, existing.id, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        finishUnchangedDeal(db, existing.id, calPayments, existing, paymentStatus, dealsToResync, counters);
        continue;
      }

      const parsed = calParsed;
      const classifiedItems = await classifyItems(parsed.items, keywords, llmPrompt);

      if (existing) {
        const hasCanonical = listDealBitrixLinks(db, existing.id).some((l) => l.isCanonical);
        db.prepare(`
              UPDATE deals SET
                title = ?, company_code = ?, manager_name = ?, start_date = ?, end_date = ?, department = ?,
                status = ?, legal_entity = ?, invoice_number = ?, budget = ?, discount = ?,
                contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
                address = ?, venue_type = ?, arrival_time = ?, ready_time = ?, work_time = ?, dismantle_time = ?,
                content_hash = ?, raw_description = ?, crm_lead_id = ?, tony_order_id = ?, data_source = 'calendar',
                payment_amount = ?, payment_status = ?, payment_count = ?, payment_hash = ?,
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName, event.start, event.end,
          keepStored(event.department, existing.department),
          keepStored(parsed.meta.status, existing.status),
          keepStored(parsed.meta.legalEntity, existing.legal_entity),
          keepStored(parsed.meta.invoiceNumber, existing.invoice_number),
          keepStored(parsed.meta.budget, existing.budget),
          keepStored(parsed.meta.discount, existing.discount),
          keepStored(parsed.contact.name, existing.contact_name),
          keepStored(parsed.contact.email, existing.contact_email),
          keepStored(parsed.contact.company, existing.contact_company),
          keepStored(parsed.contact.phone, existing.contact_phone),
          keepStored(parsed.event.address, existing.address),
          keepStored(parsed.event.venueType, existing.venue_type),
          keepStored(parsed.event.arrivalTime, existing.arrival_time),
          keepStored(parsed.event.readyTime, existing.ready_time),
          keepStored(parsed.event.workTime, existing.work_time),
          keepStored(parsed.event.dismantleTime, existing.dismantle_time),
          hash, descHtml, hasCanonical ? existing.crm_lead_id : keepStored(event.leadid, existing.crm_lead_id),
          calTonyOrderId,
          ...paymentValues(existing),
          existing.id
        );
        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        if (classifiedItems.length === 0 && existingItems.length > 0) {
          console.warn(
            `[logistics] order ${eventId} act has no positions; keeping ${existingItems.length} stored line items`,
          );
        } else {
          replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
        }
        attachEventBitrixLink(db, existing.id, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        if (existing.twenty_id && !dealsToResync.includes(existing.id)) dealsToResync.push(existing.id);
        applyTonyPaymentStatus(db, existing.id, paymentStatus, dealsToResync);
        counters.updatedDeals++;
      } else {
        if (classifiedItems.length === 0) {
          console.warn(`[logistics] order ${eventId} act has no positions`);
        }
        const insert = db.prepare(`
              INSERT INTO deals (
                crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
                start_date, end_date, department, status, legal_entity, invoice_number, budget, discount,
                contact_name, contact_email, contact_company, contact_phone, address, venue_type,
                arrival_time, ready_time, work_time, dismantle_time, tony_order_id, content_hash, raw_description,
                payment_amount, payment_status, payment_count, payment_hash
              ) VALUES (?, ?, 'calendar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
          eventId, target.dealKey, null, event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, keepStored(event.department, null),
          keepStored(parsed.meta.status, null), keepStored(parsed.meta.legalEntity, null), keepStored(parsed.meta.invoiceNumber, null),
          keepStored(parsed.meta.budget, null), keepStored(parsed.meta.discount, null),
          keepStored(parsed.contact.name, null), keepStored(parsed.contact.email, null), keepStored(parsed.contact.company, null), keepStored(parsed.contact.phone, null),
          keepStored(parsed.event.address, null), keepStored(parsed.event.venueType, null),
          keepStored(parsed.event.arrivalTime, null), keepStored(parsed.event.readyTime, null),
          keepStored(parsed.event.workTime, null), keepStored(parsed.event.dismantleTime, null),
          calTonyOrderId, hash, descHtml,
          ...paymentValues(null)
        );
        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }
        attachEventBitrixLink(db, dealId, {
          leadId: event.leadid,
          title: event.title,
          paymentAmount: linkPaymentAmount,
        });
        applyTonyPaymentStatus(db, dealId, paymentStatus, dealsToResync);
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

    const counters = { newDeals: 0, updatedDeals: 0, skippedDeals: 0, cancelledDeals: 0, restoredDeals: 0 };
    let outOfRange = 0;
    const dealsToResync = [];
    const ctx = { knownCodes, keywords, llmPrompt, counters, dealsToResync };

    let prefetched = null;
    if (config.parsePipeline === 'parallel') {
      const inRangeEvents = events.filter((event) => isEventInRange(event, startDate, endDate));
      const run = createPool({ concurrency: config.fetchConcurrency });
      console.log(
        `[parse] prefetch start {"pipeline":"parallel","concurrency":${config.fetchConcurrency},` +
        `"inRange":${inRangeEvents.length},"totalFromApi":${events.length}}`
      );
      const t0 = Date.now();
      const tonyStats = { tony_probe: 0, tony_skip: 0, tony_full: 0, tony_probe_fail: 0 };
      prefetched = await prefetchAll(inRangeEvents, tonyReady, startDate, endDate, run, {
        stamps: loadTonyUpdatedAtMap(db),
        probeEnabled: config.tonyUnchangedProbe,
        stats: tonyStats,
      });
      console.log(
        `[parse] prefetch done {"events":${prefetched.size},"ms":${Date.now() - t0},` +
        `"tony_probe":${tonyStats.tony_probe},"tony_skip":${tonyStats.tony_skip},` +
        `"tony_full":${tonyStats.tony_full},"tony_probe_fail":${tonyStats.tony_probe_fail},` +
        `"concurrency":${config.fetchConcurrency}}`
      );
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

    let missingDeals = [];
    let restoredDeals = [];
    if (inRangeCount === 0) {
      console.log(
        `[twenty-sync] ${new Date().toISOString()} parse.skip_calendar_cancel_restore {"reason":"empty_in_range_calendar"}`
      );
    } else {
      const calendarEventIds = collectCalendarEventIds(events, startDate, endDate);
      const calendarBookingNumbers = collectCalendarBookingNumbers(events, startDate, endDate);
      missingDeals = collectDealsReadyToCancelFromCalendar(
        db,
        calendarEventIds,
        startDate,
        endDate,
        calendarBookingNumbers,
      );

      if (missingDeals.length > 0) {
        console.log(
          `[twenty-sync] ${new Date().toISOString()} parse.cancel_queue {"count":${missingDeals.length},"dealIds":${JSON.stringify(missingDeals.map((d) => d.id))}}`
        );
      }

      restoredDeals = findCancelledDealsBackInCalendar(
        db,
        calendarEventIds,
        startDate,
        endDate,
        calendarBookingNumbers,
      );

      if (restoredDeals.length > 0) {
        console.log(
          `[twenty-sync] ${new Date().toISOString()} parse.restore_queue {"count":${restoredDeals.length},"dealIds":${JSON.stringify(restoredDeals.map((d) => d.id))}}`
        );
      }
    }

    const autoApproveDealIds = collectAutoApproveDealIds();
    const postParse = await runPostParseTwentySync({
      resyncDealIds: dealsToResync,
      cancelDealIds: inRangeCount === 0 ? [] : missingDeals.map((d) => d.id),
      restoreDealIds: inRangeCount === 0 ? [] : restoredDeals.map((d) => d.id),
      autoApproveDealIds,
    });
    const autoApprove = {
      mode: getSetting('approval_mode'),
      dealIds: autoApproveDealIds,
      postParse,
    };

    return {
      runId,
      total: inRangeCount,
      newDeals: counters.newDeals,
      updatedDeals: counters.updatedDeals,
      skippedDeals: counters.skippedDeals,
      cancelledDeals: counters.cancelledDeals + (postParse.cancelled_ok || 0),
      restoredDeals: counters.restoredDeals + (postParse.restored_ok || 0),
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
