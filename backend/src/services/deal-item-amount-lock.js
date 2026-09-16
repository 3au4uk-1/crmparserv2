import { findDealItemByTwentyId } from './twenty-line-item-api.js';
import { getCachedPatternLists } from './pattern-lists-cache.js';
import { getItemsForTwenty } from './twenty-items.js';
import { computeDealItemsTotal, shouldZeroLineItemAmount, parseQuantityNum } from './twenty-opportunity.js';

function assertValidAmountRub(amountRub) {
  if (typeof amountRub !== 'number' || !Number.isFinite(amountRub) || amountRub < 0) {
    const err = new Error('Amount must be a finite number >= 0');
    err.status = 400;
    throw err;
  }
}

function assertAmountLockAllowed(itemName, { restorationList, neNasheBrandingList, neNasheDecorMkList }) {
  if (shouldZeroLineItemAmount(itemName, {
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  })) {
    const err = new Error(
      'Cannot lock amount for restoration or ne-nashe item',
    );
    err.status = 400;
    throw err;
  }
}

function computeOpportunityAmountRub(db, deal) {
  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(deal.id);
  const {
    streamContext,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  } = getCachedPatternLists(db);
  const eligibleItems = getItemsForTwenty(allItems, streamContext);
  return computeDealItemsTotal(
    deal,
    eligibleItems,
    restorationList,
    { neNasheBrandingList, neNasheDecorMkList },
  );
}

export function lockDealItemAmount(db, twentyLineItemId, amountRub) {
  assertValidAmountRub(amountRub);

  const { item, deal } = findDealItemByTwentyId(db, twentyLineItemId);
  const {
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  } = getCachedPatternLists(db);
  assertAmountLockAllowed(item.name, {
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  });

  const qty = Number(item.quantity_num) > 0
    ? Number(item.quantity_num)
    : parseQuantityNum(item.quantity);
  const sum = amountRub * qty;

  db.prepare(`
    UPDATE deal_items
    SET amount_locked = 1, price = ?, sum = ?, quantity_num = ?
    WHERE id = ?
  `).run(amountRub, sum, qty, item.id);

  return {
    dealId: deal.id,
    itemId: item.id,
    amountRub,
    opportunityAmountRub: computeOpportunityAmountRub(db, deal),
  };
}
