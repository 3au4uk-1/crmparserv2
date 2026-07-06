import { findBlacklistMatch, isBlacklisted } from './blacklist.js';
import { findRestorationMatch } from './restoration.js';
import { findPodryadMatch } from './podryad.js';
import { findBannerMatch } from './banner.js';
import { computeLineItemTotal } from './twenty-opportunity.js';

const AUTO_ELIGIBLE = new Set(['keyword_match', 'llm_confirmed']);

export function isItemEligibleForTwenty(item, blacklist = []) {
  if (item.sync_override === 'include') return true;
  if (item.sync_override === 'exclude') return false;
  if (isBlacklisted(item.name, blacklist)) return false;
  return AUTO_ELIGIBLE.has(item.classification);
}

export function getItemEligibleReason(item, blacklist = []) {
  if (!isItemEligibleForTwenty(item, blacklist)) return null;
  if (item.sync_override === 'include') return 'manual_include';
  if (item.classification === 'keyword_match') return 'keyword_match';
  if (item.classification === 'llm_confirmed') return 'llm_confirmed';
  return 'auto';
}

export function getItemsForTwenty(items, blacklist = []) {
  return items.filter((item) => isItemEligibleForTwenty(item, blacklist));
}

export function enrichDealItems(
  items,
  blacklist = [],
  restorationList = [],
  deal = null,
  podryadList = [],
  bannerList = []
) {
  const dealContext = deal ? { data_source: deal.data_source } : null;
  return items.map((item) => {
    const blacklistHit = findBlacklistMatch(item.name, blacklist);
    const restorationHit = findRestorationMatch(item.name, restorationList);
    const podryadHit = findPodryadMatch(item.name, podryadList);
    const bannerHit = findBannerMatch(item.name, bannerList);
    return {
      ...item,
      blacklisted: Boolean(blacklistHit),
      blacklistMatch: blacklistHit
        ? { id: blacklistHit.id, pattern: blacklistHit.pattern, matchType: blacklistHit.matchType }
        : null,
      restorationMatch: Boolean(restorationHit),
      restorationMatchEntry: restorationHit
        ? { id: restorationHit.id, pattern: restorationHit.pattern, matchType: restorationHit.matchType }
        : null,
      podryadMatch: Boolean(podryadHit),
      podryadMatchEntry: podryadHit
        ? { id: podryadHit.id, pattern: podryadHit.pattern, matchType: podryadHit.matchType }
        : null,
      bannerMatch: Boolean(bannerHit),
      bannerMatchEntry: bannerHit
        ? { id: bannerHit.id, pattern: bannerHit.pattern, matchType: bannerHit.matchType }
        : null,
      twentyLineAmount: computeLineItemTotal(item, dealContext, restorationList),
      eligibleForTwenty: isItemEligibleForTwenty(item, blacklist),
      syncMode: item.sync_override ? 'manual' : 'auto',
      eligibleReason: getItemEligibleReason(item, blacklist),
    };
  });
}

/** @deprecated Use enrichDealItems counts in JS — SQL cannot express substring blacklist */
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
