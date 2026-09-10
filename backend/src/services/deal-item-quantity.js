import { findDealItemByTwentyId } from './twenty-line-item-api.js';
import { getCachedPatternLists } from './pattern-lists-cache.js';
import { getItemsForTwenty } from './twenty-items.js';
import { computeDealItemsTotal } from './twenty-opportunity.js';

function computeOpportunityAmountRub(db, deal) {
  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(deal.id);
  const { streamContext, restorationList, neNasheBrandingList, neNasheDecorMkList } =
    getCachedPatternLists(db);
  const eligibleItems = getItemsForTwenty(allItems, streamContext);
  return computeDealItemsTotal(
    deal,
    eligibleItems,
    restorationList,
    { neNasheBrandingList, neNasheDecorMkList },
  );
}

export function writeDealItemQuantity(db, twentyLineItemId, kolichestvo) {
  const qty = Number(kolichestvo);
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error('kolichestvo must be a finite number > 0');
    err.status = 400;
    throw err;
  }
  const { item, deal } = findDealItemByTwentyId(db, twentyLineItemId);
  if (item.amount_locked) {
    const unit = Number(item.price);
    const price = Number.isFinite(unit) && unit >= 0 ? unit : 0;
    db.prepare(`
      UPDATE deal_items
      SET quantity = ?, quantity_num = ?, sum = ?
      WHERE id = ?
    `).run(String(qty), qty, price * qty, item.id);
  } else {
    db.prepare(`
      UPDATE deal_items SET quantity = ?, quantity_num = ? WHERE id = ?
    `).run(String(qty), qty, item.id);
  }
  return {
    dealId: deal.id,
    itemId: item.id,
    kolichestvo: qty,
    opportunityAmountRub: computeOpportunityAmountRub(db, deal),
  };
}
