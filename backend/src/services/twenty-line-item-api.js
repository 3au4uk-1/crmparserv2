import { createBlacklistEntry, loadBlacklist } from './blacklist.js';
import { createRestorationEntry, loadRestorationList } from './restoration.js';
import { createPodryadEntry, loadPodryadList } from './podryad.js';
import { createBannerEntry, loadBannerList } from './banner.js';
import { enrichDealItems } from './twenty-items.js';

const LIST_CREATORS = {
  blacklist: createBlacklistEntry,
  restoration: createRestorationEntry,
  podryad: createPodryadEntry,
  banner: createBannerEntry,
};

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
  restorationMatch: false,
  podryadMatch: false,
  bannerMatch: false,
  pattern: null,
  dealId: null,
  dealTwentyId: null,
};

export function getLineItemListStatus(db, twentyLineItemId) {
  const item = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get(twentyLineItemId);
  if (!item) {
    return NEUTRAL_LINE_ITEM_LIST_STATUS;
  }

  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(item.deal_id);
  if (!deal) {
    return NEUTRAL_LINE_ITEM_LIST_STATUS;
  }

  const blacklist = loadBlacklist(db);
  const restorationList = loadRestorationList(db);
  const podryadList = loadPodryadList(db);
  const bannerList = loadBannerList(db);
  const [enriched] = enrichDealItems(
    [item],
    blacklist,
    restorationList,
    deal,
    podryadList,
    bannerList,
  );
  return {
    known: true,
    blacklisted: enriched.blacklisted,
    restorationMatch: enriched.restorationMatch,
    podryadMatch: enriched.podryadMatch,
    bannerMatch: enriched.bannerMatch,
    pattern: item.name,
    dealId: deal.id,
    dealTwentyId: deal.twenty_id ?? null,
  };
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
  return { item, deal };
}
