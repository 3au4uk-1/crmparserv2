import { computeLineItemTotal, parseQuantityNum } from './twenty-opportunity.js';
import { isPodryadItem, PODRYAD_TIP } from './podryad.js';

export function buildWarehouseItemCreateInput(name, position = 'first') {
  return { name, position };
}

function buildLineItemFields(item, options = {}) {
  const { deal = null, restorationList = [], podryadList = [] } = options;
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  const lineTotal = computeLineItemTotal(item, deal, restorationList);
  const unitPrice = qty > 0 ? lineTotal / qty : 0;

  const fields = {
    kolichestvo: qty,
    amount: {
      amountMicros: Math.round(unitPrice * 1_000_000),
      currencyCode: 'RUB',
    },
  };

  const comment = (item.comment || '').trim();
  if (comment) fields.kommentariy = comment;

  if (isPodryadItem(item.name, podryadList)) {
    fields.tip = PODRYAD_TIP;
  }

  return fields;
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  return {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
    ...buildLineItemFields(item, options),
  };
}

export function buildLineItemUpdateInput(item, options = {}) {
  return buildLineItemFields(item, options);
}
