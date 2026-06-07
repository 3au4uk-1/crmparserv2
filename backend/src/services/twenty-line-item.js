export function buildWarehouseItemCreateInput(name, position = 'first') {
  return { name, position };
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first') {
  const input = {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
  };

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

export function buildLineItemUpdateInput(item) {
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
