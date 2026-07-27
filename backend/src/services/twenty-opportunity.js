/** Twenty GraphQL enum values for Opportunity.stage (UI labels are localized separately). */
import { buildCloseDate } from '../utils/crm-dates.js';
import { isRestorationItem } from './restoration.js';
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

export function parseQuantity(value) {
  const n = Number.parseInt(String(value ?? '').replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseQuantityNum(value) {
  const normalized = String(value ?? '').replace(',', '.').replace(/\s/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Line total in rubles.
 * Tony: prefer `sum` (incl. 0); else unit `price` × qty.
 * Calendar: `price` is already «Итого» (line total), do not multiply by qty.
 */
export function computeLineItemTotal(item, deal, restorationList = []) {
  if (isRestorationItem(item.name, restorationList)) return 0;
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

export function computeDealItemsTotal(deal, items, restorationList = []) {
  return items.reduce(
    (total, item) => total + computeLineItemTotal(item, deal, restorationList),
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
  } = options;

  const brandingBudget = computeDealItemsTotal(deal, items, restorationList);

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
