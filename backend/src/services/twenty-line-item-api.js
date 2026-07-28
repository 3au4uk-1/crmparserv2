import { createBlacklistEntry } from './blacklist.js';
import { createDecorBlacklistEntry } from './decor-blacklist.js';
import { createMkBlacklistEntry } from './mk-blacklist.js';
import { createRestorationEntry } from './restoration.js';
import { createPodryadEntry } from './podryad.js';
import { createBannerEntry } from './banner.js';
import { enrichDealItems } from './twenty-items.js';
import { getCachedPatternLists, invalidatePatternListsCache } from './pattern-lists-cache.js';

const LIST_CREATORS = {
  blacklist: createBlacklistEntry,
  decor_blacklist: createDecorBlacklistEntry,
  mk_blacklist: createMkBlacklistEntry,
  restoration: createRestorationEntry,
  podryad: createPodryadEntry,
  banner: createBannerEntry,
};

const MAX_BATCH_IDS = 500;

export function findDealItemByTwentyId(db, twentyLineItemId) {
  const item = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get(twentyLineItemId);
  if (!item) {
    const err = new Error('Line item not found in parser');
    err.status = 404;
    throw err;
  }
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(item.deal_id);
  if (!deal) {
    const err = new Error('Deal not found');
    err.status = 404;
    throw err;
  }
  return { item, deal };
}

const NEUTRAL_LINE_ITEM_LIST_STATUS = {
  known: false,
  blacklisted: false,
  decorBlacklisted: false,
  mkBlacklisted: false,
  restorationMatch: false,
  podryadMatch: false,
  bannerMatch: false,
  pattern: null,
  dealId: null,
  dealTwentyId: null,
};

function statusFromEnriched(item, deal, enriched) {
  return {
    known: true,
    blacklisted: enriched.blacklisted,
    decorBlacklisted: enriched.decorBlacklisted,
    mkBlacklisted: enriched.mkBlacklisted,
    restorationMatch: enriched.restorationMatch,
    podryadMatch: enriched.podryadMatch,
    bannerMatch: enriched.bannerMatch,
    pattern: item.name,
    dealId: deal.id,
    dealTwentyId: deal.twenty_id ?? null,
  };
}

export function getLineItemListStatus(db, twentyLineItemId) {
  const item = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get(twentyLineItemId);
  if (!item) {
    return { ...NEUTRAL_LINE_ITEM_LIST_STATUS };
  }

  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(item.deal_id);
  if (!deal) {
    return { ...NEUTRAL_LINE_ITEM_LIST_STATUS };
  }

  const { streamContext, restorationList, podryadList, bannerList } = getCachedPatternLists(db);
  const [enriched] = enrichDealItems(
    [item],
    streamContext,
    restorationList,
    deal,
    podryadList,
    bannerList,
  );
  return statusFromEnriched(item, deal, enriched);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} twentyLineItemIds
 * @returns {Record<string, ReturnType<typeof getLineItemListStatus>>}
 */
export function getLineItemsListStatusBatch(db, twentyLineItemIds) {
  const ids = [
    ...new Set(
      (Array.isArray(twentyLineItemIds) ? twentyLineItemIds : [])
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean),
    ),
  ].slice(0, MAX_BATCH_IDS);

  const result = Object.create(null);
  for (const id of ids) {
    result[id] = { ...NEUTRAL_LINE_ITEM_LIST_STATUS };
  }
  if (ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(',');
  const items = db
    .prepare(`SELECT * FROM deal_items WHERE twenty_id IN (${placeholders})`)
    .all(...ids);
  if (items.length === 0) return result;

  const dealIds = [...new Set(items.map((item) => item.deal_id))];
  const dealPlaceholders = dealIds.map(() => '?').join(',');
  const deals = db
    .prepare(`SELECT * FROM deals WHERE id IN (${dealPlaceholders})`)
    .all(...dealIds);
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));

  const { streamContext, restorationList, podryadList, bannerList } = getCachedPatternLists(db);

  // Group by deal so enrichDealItems gets correct deal context once per group.
  const itemsByDealId = new Map();
  for (const item of items) {
    if (!itemsByDealId.has(item.deal_id)) itemsByDealId.set(item.deal_id, []);
    itemsByDealId.get(item.deal_id).push(item);
  }

  for (const [dealId, dealItems] of itemsByDealId) {
    const deal = dealById.get(dealId);
    if (!deal) continue;
    const enrichedItems = enrichDealItems(
      dealItems,
      streamContext,
      restorationList,
      deal,
      podryadList,
      bannerList,
    );
    for (let i = 0; i < dealItems.length; i += 1) {
      const item = dealItems[i];
      const enriched = enrichedItems[i];
      if (!item.twenty_id) continue;
      result[item.twenty_id] = statusFromEnriched(item, deal, enriched);
    }
  }

  return result;
}

export function addDealItemToList(db, twentyLineItemId, list) {
  const creator = LIST_CREATORS[list];
  if (!creator) {
    const err = new Error('Invalid list');
    err.status = 400;
    throw err;
  }
  const { item, deal } = findDealItemByTwentyId(db, twentyLineItemId);
  try {
    creator(db, { pattern: item.name, matchType: 'exact', sourceName: item.name });
  } catch (err) {
    if (err.status !== 409) throw err;
  }
  invalidatePatternListsCache();
  return { item, deal };
}
