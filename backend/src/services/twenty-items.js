import { findBlacklistMatch, isBlacklisted, loadBlacklist } from './blacklist.js';
import { findDecorBlacklistMatch, loadDecorBlacklist } from './decor-blacklist.js';
import { findMkBlacklistMatch, loadMkBlacklist } from './mk-blacklist.js';
import { findRestorationMatch } from './restoration.js';
import { findTipRuleMatch } from './tip-rules.js';
import { classifyProductStream } from './product-stream.js';
import { computeLineItemTotal } from './twenty-opportunity.js';

const AUTO_ELIGIBLE = new Set(['keyword_match', 'llm_confirmed']);

export function buildProductStreamContext({
  brandingKeywords = [],
  decorKeywords = [],
  mkKeywords = [],
  brandingBlacklist = [],
  decorBlacklist = [],
  mkBlacklist = [],
} = {}) {
  return {
    brandingKeywords,
    decorKeywords,
    mkKeywords,
    brandingBlacklist,
    decorBlacklist,
    mkBlacklist,
  };
}

export function loadProductStreamContext(db) {
  const brandingKeywords = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key = 'keywords'").get()?.value || '[]',
  );
  const decorKeywords = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key = 'decor_keywords'").get()?.value || '[]',
  );
  const mkKeywords = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key = 'mk_keywords'").get()?.value || '[]',
  );

  return buildProductStreamContext({
    brandingKeywords,
    decorKeywords,
    mkKeywords,
    brandingBlacklist: loadBlacklist(db),
    decorBlacklist: loadDecorBlacklist(db),
    mkBlacklist: loadMkBlacklist(db),
  });
}

function normalizeStreamContext(context) {
  if (Array.isArray(context)) {
    return buildProductStreamContext({ brandingBlacklist: context });
  }
  return context || buildProductStreamContext();
}

export function resolveItemProductStream(item, context) {
  const ctx = normalizeStreamContext(context);

  const stream = classifyProductStream({
    name: item.name,
    brandingKeywords: ctx.brandingKeywords,
    decorKeywords: ctx.decorKeywords,
    mkKeywords: ctx.mkKeywords,
    brandingBlacklist: ctx.brandingBlacklist,
    decorBlacklist: ctx.decorBlacklist,
    mkBlacklist: ctx.mkBlacklist,
  });

  if (stream) return stream;

  if (
    AUTO_ELIGIBLE.has(item.classification)
    && !isBlacklisted(item.name, ctx.brandingBlacklist)
  ) {
    return 'BRANDING';
  }

  return null;
}

export function isItemEligibleForTwenty(item, context = []) {
  if (item.sync_override === 'include') return true;
  if (item.sync_override === 'exclude') return false;
  return resolveItemProductStream(item, context) !== null;
}

export function getItemEligibleReason(item, context = []) {
  if (!isItemEligibleForTwenty(item, context)) return null;
  if (item.sync_override === 'include') return 'manual_include';

  const stream = resolveItemProductStream(item, context);
  if (stream === 'DECOR') return 'decor_keyword';
  if (stream === 'MK') return 'mk_keyword';
  if (item.classification === 'keyword_match') return 'keyword_match';
  if (item.classification === 'llm_confirmed') return 'llm_confirmed';
  return 'auto';
}

export function getItemsForTwenty(items, context = []) {
  const ctx = normalizeStreamContext(context);

  return items
    .filter((item) => isItemEligibleForTwenty(item, ctx))
    .map((item) => {
      const productStream = resolveItemProductStream(item, ctx)
        || (item.sync_override === 'include' ? 'BRANDING' : null);
      return productStream ? { ...item, productStream } : item;
    })
    .filter((item) => item.productStream);
}

export function enrichDealItems(
  items,
  context = [],
  restorationList = [],
  deal = null,
  tipRules = [],
) {
  const ctx = normalizeStreamContext(context);
  const dealContext = deal ? { data_source: deal.data_source } : null;

  return items.map((item) => {
    const blacklistHit = findBlacklistMatch(item.name, ctx.brandingBlacklist);
    const decorBlacklistHit = findDecorBlacklistMatch(item.name, ctx.decorBlacklist);
    const mkBlacklistHit = findMkBlacklistMatch(item.name, ctx.mkBlacklist);
    const restorationHit = findRestorationMatch(item.name, restorationList);
    const tipHit = findTipRuleMatch(item.name, tipRules);
    const productStream = resolveItemProductStream(item, ctx)
      || (item.sync_override === 'include' ? 'BRANDING' : null);

    return {
      ...item,
      blacklisted: Boolean(blacklistHit),
      decorBlacklisted: Boolean(decorBlacklistHit),
      mkBlacklisted: Boolean(mkBlacklistHit),
      productStream,
      blacklistMatch: blacklistHit
        ? { id: blacklistHit.id, pattern: blacklistHit.pattern, matchType: blacklistHit.matchType }
        : null,
      restorationMatch: Boolean(restorationHit),
      restorationMatchEntry: restorationHit
        ? { id: restorationHit.id, pattern: restorationHit.pattern, matchType: restorationHit.matchType }
        : null,
      tipRuleMatch: Boolean(tipHit),
      tipRuleMatchEntry: tipHit
        ? {
            id: tipHit.id,
            pattern: tipHit.pattern,
            matchType: tipHit.matchType,
            tip: tipHit.tip,
            tipDetail: tipHit.tipDetail,
          }
        : null,
      podryadMatch: tipHit?.tip === 'PODRYAD',
      bannerMatch: tipHit?.tip === 'BANNERA',
      twentyLineAmount: computeLineItemTotal(item, dealContext, restorationList),
      eligibleForTwenty: isItemEligibleForTwenty(item, ctx),
      syncMode: item.sync_override ? 'manual' : 'auto',
      eligibleReason: getItemEligibleReason(item, ctx),
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
