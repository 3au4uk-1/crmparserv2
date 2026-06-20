import { computeLineItemTotal, parseQuantityNum } from './twenty-opportunity.js';

export function buildWarehouseItemCreateInput(name, position = 'first') {
  return { name, position };
}

function buildLineItemFields(item, deal) {
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  const lineTotal = computeLineItemTotal(item, deal);
  const unitPrice = qty > 0 ? lineTotal / qty : 0;

  const fields = {
    kolichestvo: qty,
    quantity: null,
    amount: {
      amountMicros: Math.round(unitPrice * 1_000_000),
      currencyCode: 'RUB',
    },
  };

  const comment = (item.comment || '').trim();
  if (comment) fields.kommentariy = comment;

  return fields;
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  const { deal = null } = options;
  return {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
    ...buildLineItemFields(item, deal),
  };
}

export function buildLineItemUpdateInput(item, options = {}) {
  const { deal = null } = options;
  return buildLineItemFields(item, deal);
}
