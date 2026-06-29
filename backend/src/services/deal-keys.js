/** Stable deal key for a booking number (shared across calendar events). */
export function bookingDealKey(bookingNumber) {
  return `booking#${bookingNumber}`;
}

/** Event-scoped fallback when the title has no booking numbers. */
export function calDealKey(crmEventId) {
  return `${crmEventId}#cal`;
}

/** Extract booking number from deal_key / tony_order_id, or null. */
export function resolveBookingNumber(deal) {
  if (deal.tony_order_id) return String(deal.tony_order_id);
  const key = deal.deal_key || '';
  if (key.startsWith('booking#')) return key.slice('booking#'.length);
  if (key.startsWith('import#')) return key.slice('import#'.length);
  const m = key.match(/#(\d{5,7})$/);
  return m?.[1] ?? null;
}

export function isBookingDealKey(dealKey) {
  return dealKey?.startsWith('booking#') || dealKey?.startsWith('import#');
}
