const AUTO_ELIGIBLE = new Set(['keyword_match', 'llm_confirmed']);

export function isItemEligibleForTwenty(item) {
  if (item.sync_override === 'include') return true;
  if (item.sync_override === 'exclude') return false;
  return AUTO_ELIGIBLE.has(item.classification);
}

export function getItemEligibleReason(item) {
  if (!isItemEligibleForTwenty(item)) return null;
  if (item.sync_override === 'include') return 'manual_include';
  if (item.classification === 'keyword_match') return 'keyword_match';
  if (item.classification === 'llm_confirmed') return 'llm_confirmed';
  return 'auto';
}

export function getItemsForTwenty(items) {
  return items.filter(isItemEligibleForTwenty);
}

export function enrichDealItems(items) {
  return items.map((item) => ({
    ...item,
    eligibleForTwenty: isItemEligibleForTwenty(item),
    syncMode: item.sync_override ? 'manual' : 'auto',
    eligibleReason: getItemEligibleReason(item),
  }));
}

/** Must mirror isItemEligibleForTwenty — NULL != 'exclude' is NULL in SQL, not TRUE. */
export const TWENTY_ELIGIBLE_COUNT_SQL = `
  (SELECT COUNT(*) FROM deal_items di
    WHERE di.deal_id = d.id
      AND (
        di.sync_override = 'include'
        OR (
          (di.sync_override IS NULL OR di.sync_override = '')
          AND di.classification IN ('keyword_match', 'llm_confirmed')
        )
      )
  )
`;
