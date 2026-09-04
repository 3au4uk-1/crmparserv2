import { computeLineItemTotal, parseQuantityNum, DEFAULT_OPPORTUNITY_STAGE } from './twenty-opportunity.js';
import { findTipRuleMatch } from './tip-rules.js';
import { resolveTipDetail } from './tip-taxonomy.js';
import { sortProductStreams, coerceProductStreams } from './product-stream.js';

export function buildWarehouseItemCreateInput(name, position = 'first') {
  return { name, position };
}

function buildLineItemFields(item, options = {}) {
  const {
    deal = null,
    restorationList = [],
    tipRules = [],
    neNasheBrandingList = [],
    neNasheDecorMkList = [],
  } = options;
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  const neNasheLists = { neNasheBrandingList, neNasheDecorMkList };
  const lineTotal = computeLineItemTotal(item, deal, restorationList, neNasheLists);
  const unitPrice = qty > 0 ? lineTotal / qty : 0;

  const fields = {
    kolichestvo: qty,
    istochnik: 'PARSER',
    amount: {
      amountMicros: Math.round(unitPrice * 1_000_000),
      currencyCode: 'RUB',
    },
  };

  if (item.productStream === 'BRANDING' || item.productStream === 'DECOR' || item.productStream === 'MK') {
    fields.productStream = item.productStream;
  }

  const comment = (item.comment || '').trim();
  if (comment) fields.kommentariy = comment;

  const tipRule = findTipRuleMatch(item.name, tipRules);
  if (tipRule) {
    fields.tip = tipRule.tip;
    fields.tipDetail = resolveTipDetail(tipRule);
  }

  const productStreams = sortProductStreams(
    item.productStreams ?? coerceProductStreams(item.productStream),
  );
  if (productStreams.length > 0) {
    fields.productStream = productStreams;
  }

  return fields;
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  return {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
    stage: DEFAULT_OPPORTUNITY_STAGE,
    ...buildLineItemFields(item, options),
  };
}

export function buildLineItemUpdateInput(item, options = {}) {
  return buildLineItemFields(item, options);
}
