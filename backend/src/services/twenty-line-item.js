import { parseQuantityNum } from './twenty-opportunity.js';

export function buildWarehouseItemCreateInput(name, position = 'first') {
  return { name, position };
}

function effectiveTonyUnitPrice(item) {
  const qty = Math.max(item.quantity_num ?? parseQuantityNum(item.quantity), 1);
  const sum = item.sum ?? 0;
  return sum / qty;
}

function buildTonyLineItemFields(item) {
  const fields = {};
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  fields.kolichestvo = qty;

  const comment = (item.comment || '').trim();
  if (comment) fields.kommentariy = comment;

  const unitPrice = effectiveTonyUnitPrice(item);
  fields.amount = {
    amountMicros: Math.round(unitPrice * 1_000_000),
    currencyCode: 'RUB',
  };
  return fields;
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  const { dataSource = 'calendar' } = options;
  const input = {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
  };

  if (dataSource === 'tony') {
    Object.assign(input, buildTonyLineItemFields(item));
  } else {
    if (item.quantity != null && item.quantity !== '') {
      input.quantity = String(item.quantity);
    }

    if (item.price != null && !Number.isNaN(item.price)) {
      input.amount = {
        amountMicros: Math.round(item.price * 1_000_000),
        currencyCode: 'RUB',
      };
    }
  }

  return input;
}

export function buildLineItemUpdateInput(item, options = {}) {
  const { dataSource = 'calendar' } = options;
  if (dataSource === 'tony') return buildTonyLineItemFields(item);

  const input = {};

  if (item.quantity != null && item.quantity !== '') {
    input.quantity = String(item.quantity);
  }

  if (item.price != null && !Number.isNaN(item.price)) {
    input.amount = {
      amountMicros: Math.round(item.price * 1_000_000),
      currencyCode: 'RUB',
    };
  }

  return input;
}
