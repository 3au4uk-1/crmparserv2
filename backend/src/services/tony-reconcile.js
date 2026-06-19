/** Compute the desired set of deal keys for an event given its valid booking numbers. */
export function desiredDealKeys(crmEventId, validBookingNumbers) {
  if (!validBookingNumbers || validBookingNumbers.length === 0) {
    return [{ dealKey: `${crmEventId}#cal`, source: 'calendar', bookingNumber: null }];
  }
  return validBookingNumbers.map((n) => ({
    dealKey: `${crmEventId}#${n}`,
    source: 'tony',
    bookingNumber: n,
  }));
}

/**
 * Plan reconciliation for one event:
 * - desired: target deal keys
 * - relink: { dealId, newDealKey, bookingNumber } when an existing single `#cal` deal
 *   should be converted in place to a single new tony booking (preserves approval/overrides/twenty_id)
 * - removeDealIds: existing deal ids whose key is no longer desired (to be cancelled)
 */
export function planEventReconciliation(db, crmEventId, validBookingNumbers) {
  const desired = desiredDealKeys(crmEventId, validBookingNumbers);
  const desiredKeys = new Set(desired.map((d) => d.dealKey));

  const existing = db
    .prepare('SELECT id, deal_key, data_source FROM deals WHERE crm_event_id = ?')
    .all(crmEventId);

  let relink = null;
  const existingCal = existing.filter((d) => d.deal_key === `${crmEventId}#cal`);
  if (
    existingCal.length === 1 &&
    existing.length === 1 &&
    desired.length === 1 &&
    desired[0].source === 'tony'
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
