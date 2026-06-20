/** Compute the desired set of deal keys for an event from the title's booking numbers. */
export function desiredDealKeys(crmEventId, bookingNumbers) {
  if (!bookingNumbers || bookingNumbers.length === 0) {
    return [{ dealKey: `${crmEventId}#cal`, bookingNumber: null }];
  }
  return bookingNumbers.map((n) => ({
    dealKey: `${crmEventId}#${n}`,
    bookingNumber: n,
  }));
}

/**
 * Plan reconciliation for one event based on the booking numbers found in its title:
 * - desired: target deal keys (one per booking, or a single `#cal` when none)
 * - relink: { dealId, newDealKey, bookingNumber } when a lone existing `#cal` deal
 *   should be converted in place to a single new booking (preserves approval/overrides/twenty_id).
 *   The parser keeps the row's existing data_source and only changes its key/booking.
 * - removeDealIds: existing deal ids whose key is no longer desired (booking removed from title).
 *
 * Identity is title-driven (NOT dependent on Tony reachability), so a Tony outage neither
 * duplicates nor removes deals.
 */
export function planEventReconciliation(db, crmEventId, bookingNumbers) {
  const desired = desiredDealKeys(crmEventId, bookingNumbers);
  const desiredKeys = new Set(desired.map((d) => d.dealKey));

  const existing = db
    .prepare('SELECT id, deal_key FROM deals WHERE crm_event_id = ?')
    .all(crmEventId);

  let relink = null;
  const calKey = `${crmEventId}#cal`;
  const existingCal = existing.filter((d) => d.deal_key === calKey);
  if (
    existingCal.length === 1 &&
    existing.length === 1 &&
    desired.length === 1 &&
    desired[0].bookingNumber !== null
  ) {
    relink = {
      dealId: existingCal[0].id,
      newDealKey: desired[0].dealKey,
      bookingNumber: desired[0].bookingNumber,
    };
  }

  const relinkedId = relink ? relink.dealId : null;
  const removeDealIds = existing
    .filter((d) => !desiredKeys.has(d.deal_key) && d.id !== relinkedId)
    .map((d) => d.id);

  return { desired, relink, removeDealIds };
}
