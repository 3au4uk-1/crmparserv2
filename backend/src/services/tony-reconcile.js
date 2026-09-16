import { bookingDealKey, calDealKey } from './deal-keys.js';

/** Compute the desired set of deal keys for an event from the title's booking numbers. */
export function desiredDealKeys(crmEventId, bookingNumbers) {
  if (!bookingNumbers || bookingNumbers.length === 0) {
    return [{ dealKey: calDealKey(crmEventId), bookingNumber: null }];
  }
  return bookingNumbers.map((n) => ({
    dealKey: bookingDealKey(n),
    bookingNumber: n,
  }));
}

function isLegacyEventBookingKey(dealKey, crmEventId) {
  return dealKey?.startsWith(`${crmEventId}#`) && !dealKey.endsWith('#cal');
}

/**
 * Plan reconciliation for one event based on the booking numbers found in its title:
 * - desired: target deal keys (one per booking, or a single `#cal` when none)
 * - relink: { dealId, newDealKey, bookingNumber } when a lone existing `#cal` deal
 *   should be converted in place to a single new booking (preserves approval/overrides/twenty_id).
 * - removeDealIds: obsolete event-scoped rows for this event (calendar fallback or legacy keys).
 *   Booking-centric deals (`booking#N`) are never removed here — they may be shared across events.
 *   Synced `#cal` rows (`twenty_id` set) are not cancelled when bookings appear.
 *
 * Identity is title-driven (NOT dependent on Tony reachability), so a Tony outage neither
 * duplicates nor removes deals.
 */
export function planEventReconciliation(db, crmEventId, bookingNumbers) {
  const desired = desiredDealKeys(crmEventId, bookingNumbers);
  const desiredKeys = new Set(desired.map((d) => d.dealKey));
  const bookingSet = new Set(bookingNumbers || []);

  const existing = db
    .prepare('SELECT id, deal_key, twenty_id FROM deals WHERE crm_event_id = ?')
    .all(crmEventId);

  let relink = null;
  const calKey = calDealKey(crmEventId);
  const existingCal = existing.filter((d) => d.deal_key === calKey);
  if (
    existingCal.length === 1 &&
    existing.length === 1 &&
    desired.length >= 1 &&
    desired[0].bookingNumber !== null
  ) {
    const globalBooking = db
      .prepare('SELECT id FROM deals WHERE deal_key = ?')
      .get(desired[0].dealKey);
    if (!globalBooking) {
      relink = {
        dealId: existingCal[0].id,
        newDealKey: desired[0].dealKey,
        bookingNumber: desired[0].bookingNumber,
      };
    }
  }

  const relinkedId = relink ? relink.dealId : null;
  const removeDealIds = [];

  for (const d of existing) {
    if (d.id === relinkedId) continue;

    if (d.deal_key === calKey) {
      if (!desiredKeys.has(calKey) && !d.twenty_id) {
        removeDealIds.push(d.id);
      }
      continue;
    }

    if (isLegacyEventBookingKey(d.deal_key, crmEventId)) {
      const legacyBooking = d.deal_key.slice(crmEventId.length + 1);
      if (!bookingSet.has(legacyBooking)) removeDealIds.push(d.id);
      continue;
    }

  }

  if (
    existingCal.length === 1 &&
    desired.length >= 1 &&
    desired[0].bookingNumber !== null &&
    !relink &&
    !existingCal[0].twenty_id
  ) {
    const globalBooking = db
      .prepare('SELECT id FROM deals WHERE deal_key = ?')
      .get(desired[0].dealKey);
    if (globalBooking && globalBooking.id !== existingCal[0].id) {
      removeDealIds.push(existingCal[0].id);
    }
  }

  return { desired, relink, removeDealIds: [...new Set(removeDealIds)] };
}
