/** Twenty GraphQL enum values for Opportunity.stage (UI labels are localized separately). */
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

export function buildOpportunityInput(deal, items, options = {}) {
  const {
    includeStage = false,
    stage = DEFAULT_OPPORTUNITY_STAGE,
    companyTwentyId = null,
    personTwentyId = null,
  } = options;

  const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0), 0);

  const input = {
    name: deal.title || `Deal ${deal.crm_event_id}`,
    closeDate: deal.start_date || deal.end_date || new Date().toISOString(),
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

  return input;
}
