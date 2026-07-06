import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { authenticate } from './auth.js';
import { fetchDescription, parseDescriptionResponse } from './parser.js';
import {
  applyPaymentAggregateToDb,
  parseCalendarPayments,
} from './payment-parser.js';
import { requireTwentyConfig } from './twenty-config.js';
import { buildPaymentFieldsInput } from './twenty-opportunity.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from './twenty-gql.js';
import { normalizeExportRange } from '../utils/crm-dates.js';

const UPDATE_OPPORTUNITY_PAYMENTS_MUTATION = `
  mutation UpdateOpportunityPayments($id: ID!, $input: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $input) { id }
  }
`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizePaymentSyncRange(from, to) {
  return normalizeExportRange(from, to);
}

export function loadDealsForPaymentSync(db, from, to) {
  return db.prepare(`
    SELECT id, crm_event_id, twenty_id, payment_hash, payment_amount, payment_status
    FROM deals
    WHERE crm_event_id IS NOT NULL
      AND TRIM(crm_event_id) != ''
      AND date(start_date) >= date(?)
      AND date(start_date) <= date(?)
    ORDER BY start_date, id
  `).all(from, to);
}

export function countPaymentSyncTargets(db, from, to) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS dealsInRange,
      SUM(CASE WHEN twenty_id IS NOT NULL AND TRIM(twenty_id) != '' THEN 1 ELSE 0 END) AS dealsInTwenty
    FROM deals
    WHERE crm_event_id IS NOT NULL
      AND TRIM(crm_event_id) != ''
      AND date(start_date) >= date(?)
      AND date(start_date) <= date(?)
  `).get(from, to);
  return {
    dealsInRange: row?.dealsInRange ?? 0,
    dealsInTwenty: row?.dealsInTwenty ?? 0,
  };
}

export function groupDealsByEvent(deals) {
  const byEvent = new Map();
  for (const deal of deals) {
    const eventId = String(deal.crm_event_id);
    if (!byEvent.has(eventId)) byEvent.set(eventId, []);
    byEvent.get(eventId).push(deal);
  }
  return byEvent;
}

export async function pushPaymentToTwenty(twenty, twentyId, aggregate) {
  const resp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    UPDATE_OPPORTUNITY_PAYMENTS_MUTATION,
    {
      id: twentyId,
      input: buildPaymentFieldsInput({
        payment_amount: aggregate.paymentAmount,
        payment_status: aggregate.paymentStatus,
      }),
    },
  );
  assertHttpSuccess(resp, twenty.apiUrl);
  assertGqlSuccess(resp, `Failed to update payments for Twenty opportunity ${twentyId}`);
}

export async function runPaymentSync({ from, to, onProgress } = {}) {
  const { start, end } = normalizePaymentSyncRange(from, to);
  const fromDate = from;
  const toDate = to;

  await authenticate();
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deals = loadDealsForPaymentSync(db, fromDate, toDate);
  const byEvent = groupDealsByEvent(deals);

  let dealsProcessed = 0;
  let dealsUpdatedLocal = 0;
  let dealsUpdatedTwenty = 0;
  let dealsWithPayments = 0;
  let dealsFailed = 0;
  const errors = [];

  reportProgress(onProgress, {
    stage: 'fetching_calendar',
    dealsTargeted: deals.length,
    eventsTotal: byEvent.size,
    dealsProcessed: 0,
  });

  for (const [eventId, eventDeals] of byEvent) {
    let aggregate;
    try {
      const descJson = await fetchDescription(eventId);
      const { calPayments } = parseDescriptionResponse(descJson);
      aggregate = parseCalendarPayments(calPayments);
    } catch (err) {
      dealsFailed += eventDeals.length;
      errors.push(`Событие ${eventId}: ${err.message}`);
      dealsProcessed += eventDeals.length;
      reportProgress(onProgress, {
        stage: 'fetching_calendar',
        dealsTargeted: deals.length,
        dealsProcessed,
        dealsUpdatedLocal,
        dealsUpdatedTwenty,
        dealsFailed,
      });
      await delay(config.tonyRequestDelayMs || 350);
      continue;
    }

    if (aggregate.paymentAmount > 0) {
      dealsWithPayments += eventDeals.length;
    }

    for (const deal of eventDeals) {
      try {
        applyPaymentAggregateToDb(db, deal.id, aggregate);
        dealsUpdatedLocal += 1;

        if (deal.twenty_id) {
          await pushPaymentToTwenty(twenty, deal.twenty_id, aggregate);
          dealsUpdatedTwenty += 1;
        }
      } catch (err) {
        dealsFailed += 1;
        errors.push(`Сделка ${deal.id} (${deal.title || eventId}): ${err.message}`);
      }
      dealsProcessed += 1;
    }

    reportProgress(onProgress, {
      stage: 'syncing',
      dealsTargeted: deals.length,
      dealsProcessed,
      dealsUpdatedLocal,
      dealsUpdatedTwenty,
      dealsWithPayments,
      dealsFailed,
    });

    await delay(config.tonyRequestDelayMs || 350);
  }

  return {
    from: fromDate,
    to: toDate,
    range: { start, end },
    dealsTargeted: deals.length,
    eventsProcessed: byEvent.size,
    dealsProcessed,
    dealsUpdatedLocal,
    dealsUpdatedTwenty,
    dealsWithPayments,
    dealsFailed,
    errors,
  };
}

function reportProgress(onProgress, payload) {
  if (typeof onProgress === 'function') {
    onProgress(payload);
  }
}
