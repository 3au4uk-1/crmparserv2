/** Twenty GraphQL enum values for Opportunity.stage (UI labels are localized separately). */
import { buildCloseDate } from '../utils/crm-dates.js';
import { isRestorationItem } from './restoration.js';
import { isNeNasheBrandingItem } from './ne-nashe-branding.js';
import { isNeNasheDecorMkItem } from './ne-nashe-decor-mk.js';
import { PAYMENT_FIELDS, PAYMENT_STATUS } from './payment-field-names.js';

export function buildPaymentFieldsInput(deal) {
  const input = {
    [PAYMENT_FIELDS.status]: deal.payment_status || PAYMENT_STATUS.NONE,
    [PAYMENT_FIELDS.amount]: {
      amountMicros: Math.round((deal.payment_amount || 0) * 1_000_000),
      currencyCode: 'RUB',
    },
  };
  return input;
}

export const OPPORTUNITY_STAGE_OPTIONS = [
  { value: 'NOVYY', label: 'Новый' },
  { value: 'V_RABOTE', label: 'В работе' },
  { value: 'V_PECHATI', label: 'В печати' },
  { value: 'OKLEYKA', label: 'Оклейка' },
  { value: 'RESTOVRACIYA', label: 'Реставрация' },
  { value: 'GOTOVO', label: 'Готово' },
  { value: 'OTMENA', label: 'Отмена' },
];

export const DEFAULT_OPPORTUNITY_STAGE = 'NOVYY';
export const CANCELLED_OPPORTUNITY_STAGE = 'OTMENA';
export const V_PECHATI_OPPORTUNITY_STAGE = 'V_PECHATI';

export const ZERO_RUB_AMOUNT = { amountMicros: 0, currencyCode: 'RUB' };

export function isCancelledLineItemStage(stage) {
  return stage === CANCELLED_OPPORTUNITY_STAGE;
}

export function sumNonCancelledLineAmountsRub(lineItems) {
  let total = 0;
  for (const item of lineItems || []) {
    if (isCancelledLineItemStage(item?.stage)) continue;
    const micros = item?.amount?.amountMicros ?? item?.amountMicros;
    if (typeof micros !== 'number' || !Number.isFinite(micros)) continue;
    const qty = parseQuantityNum(item?.kolichestvo ?? item?.quantity_num ?? item?.quantity);
    total += (micros / 1_000_000) * qty;
  }
  return total;
}

export function buildOpportunityAmountInputFromLineItems(lineItems) {
  const rub = sumNonCancelledLineAmountsRub(lineItems);
  return { amountMicros: Math.round(rub * 1_000_000), currencyCode: 'RUB' };
}

export function parseQuantity(value) {
  const n = Number.parseInt(String(value ?? '').replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseQuantityNum(value) {
  const normalized = String(value ?? '').replace(',', '.').replace(/\s/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function shouldZeroLineItemAmount(itemName, {
  restorationList = [],
  neNasheBrandingList = [],
  neNasheDecorMkList = [],
} = {}) {
  return (
    isRestorationItem(itemName, restorationList)
    || isNeNasheBrandingItem(itemName, neNasheBrandingList)
    || isNeNasheDecorMkItem(itemName, neNasheDecorMkList)
  );
}

/** Line total in rubles.
 * Tony: prefer `sum` (incl. 0); else unit `price` × qty.
 * Calendar: `price` is already «Итого» (line total), do not multiply by qty.
 */
export function computeLineItemTotal(item, deal, restorationList = [], neNasheLists = {}) {
  const branding = neNasheLists.neNasheBrandingList ?? [];
  const decorMk = neNasheLists.neNasheDecorMkList ?? [];
  if (shouldZeroLineItemAmount(item.name, {
    restorationList,
    neNasheBrandingList: branding,
    neNasheDecorMkList: decorMk,
  })) return 0;
  if (item.amount_locked) {
    const unit = Number(item.price);
    if (!Number.isFinite(unit) || unit < 0) return 0;
    const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
    return unit * qty;
  }
  const isTony = deal?.data_source === 'tony';
  if (isTony && item.sum != null && Number.isFinite(item.sum)) {
    return item.sum;
  }
  if (item.sum != null && item.sum > 0) {
    return item.sum;
  }
  if (!isTony) {
    return item.price || 0;
  }
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  return (item.price || 0) * qty;
}

export function computeDealItemsTotal(deal, items, restorationList = [], neNasheLists = {}) {
  return items.reduce(
    (total, item) => total + computeLineItemTotal(item, deal, restorationList, neNasheLists),
    0
  );
}

export function buildOpportunityInput(deal, items, options = {}) {
  const {
    includeStage = false,
    stage = DEFAULT_OPPORTUNITY_STAGE,
    companyTwentyId = null,
    personTwentyId = null,
    restorationList = [],
    neNasheBrandingList = [],
    neNasheDecorMkList = [],
  } = options;

  const neNasheLists = { neNasheBrandingList, neNasheDecorMkList };
  const brandingBudget = computeDealItemsTotal(deal, items, restorationList, neNasheLists);

  const input = {
    name: deal.title || `Deal ${deal.crm_event_id}`,
    closeDate: buildCloseDate(deal),
    amount: {
      amountMicros: Math.round(brandingBudget * 1_000_000),
      currencyCode: 'RUB',
    },
  };

  if (includeStage) input.stage = stage;
  if (companyTwentyId) input.companyId = companyTwentyId;
  if (personTwentyId) input.pointOfContactId = personTwentyId;

  if (deal.tony_order_id) {
    input.tonyLink = {
      primaryLinkUrl: `https://crm.apihide.com/orders/orders_edit/?id=${deal.tony_order_id}`,
      primaryLinkLabel: `Tony #${deal.tony_order_id}`,
    };
  }

  if (deal.crm_lead_id) {
    const leadId = deal.crm_lead_id.trim();
    input.bitrixLink = {
      primaryLinkUrl: `https://prointeractive.bitrix24.ru/crm/deal/details/${leadId}/?any`,
      primaryLinkLabel: `Bitrix #${leadId}`,
    };
  }

  if (deal.arrival_time) input.arrivalTime = deal.arrival_time;
  if (deal.ready_time) input.readyTime = deal.ready_time;
  if (deal.work_time) input.workTime = deal.work_time;
  if (deal.dismantle_time) input.dismantleTime = deal.dismantle_time;

  if (deal.load_date) {
    const time = /^\d{1,2}:\d{2}$/.test(deal.load_time || '') ? deal.load_time : '00:00';
    input.loadDate = `${deal.load_date}T${time.padStart(5, '0')}:00+03:00`;
  }

  if (deal.payment_amount != null && deal.payment_amount > 0) {
    input[PAYMENT_FIELDS.amount] = {
      amountMicros: Math.round(deal.payment_amount * 1_000_000),
      currencyCode: 'RUB',
    };
  }
  if (deal.payment_status) {
    input[PAYMENT_FIELDS.status] = deal.payment_status;
  }

  return input;
}

function linkUrl(value) {
  return value?.primaryLinkUrl || value || null;
}

function isMissingInstant(value) {
  return value == null || value === '';
}

function instantsEqual(a, b) {
  if (isMissingInstant(a) && isMissingInstant(b)) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}

export function opportunityFieldsEqual(existing, next) {
  if (!existing) return false;
  if ((existing.name || '') !== (next.name || '')) return false;
  if ((existing.amount?.amountMicros ?? 0) !== (next.amount?.amountMicros ?? 0)) return false;
  if ((existing.companyId || null) !== (next.companyId || null)) return false;
  if ((existing.pointOfContactId || null) !== (next.pointOfContactId || null)) return false;
  if (!instantsEqual(existing.closeDate, next.closeDate)) return false;
  if ((existing.arrivalTime || null) !== (next.arrivalTime || null)) return false;
  if ((existing.readyTime || null) !== (next.readyTime || null)) return false;
  if ((existing.workTime || null) !== (next.workTime || null)) return false;
  if ((existing.dismantleTime || null) !== (next.dismantleTime || null)) return false;
  if (!instantsEqual(existing.loadDate, next.loadDate)) return false;
  if (linkUrl(existing.tonyLink) !== linkUrl(next.tonyLink)) return false;
  if (linkUrl(existing.bitrixLink) !== linkUrl(next.bitrixLink)) return false;
  if (Object.prototype.hasOwnProperty.call(next, PAYMENT_FIELDS.amount)) {
    const existingMicros = existing[PAYMENT_FIELDS.amount]?.amountMicros ?? 0;
    const nextMicros = next[PAYMENT_FIELDS.amount]?.amountMicros ?? 0;
    if (existingMicros !== nextMicros) return false;
  }
  if (Object.prototype.hasOwnProperty.call(next, PAYMENT_FIELDS.status)) {
    if ((existing[PAYMENT_FIELDS.status] || null) !== (next[PAYMENT_FIELDS.status] || null)) return false;
  }
  return true;
}

export function applyLineItemMutationsInMemory(existingLineItems, {
  toUpdate = [],
  toDelete = [],
  createdNodes = [],
} = {}) {
  const deleted = new Set(toDelete);
  const updates = new Map(toUpdate.map(({ twentyId, item, data }) => [twentyId, data || item]));
  const next = [];
  for (const li of existingLineItems || []) {
    if (deleted.has(li.id)) continue;
    const patch = updates.get(li.id);
    if (!patch) {
      next.push(li);
      continue;
    }
    next.push({
      ...li,
      kolichestvo: patch.kolichestvo ?? li.kolichestvo,
      amount: patch.amount ?? li.amount,
      stage: li.stage,
    });
  }
  for (const node of createdNodes) next.push(node);
  return next;
}
