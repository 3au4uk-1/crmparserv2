import { loadRestorationList } from './restoration.js';
import { loadNeNasheBrandingList } from './ne-nashe-branding.js';
import { loadNeNasheDecorMkList } from './ne-nashe-decor-mk.js';
import { loadTipRules } from './tip-rules.js';
import { loadProductStreamContext } from './twenty-items.js';

const TTL_MS = 30_000;

let cache = null;
let cacheAt = 0;

export function getCachedPatternLists(db) {
  if (cache && Date.now() - cacheAt < TTL_MS) {
    return cache;
  }

  const streamContext = loadProductStreamContext(db);
  cache = {
    streamContext,
    // Keep legacy key for callers that still expect `blacklist`.
    blacklist: streamContext.brandingBlacklist,
    restorationList: loadRestorationList(db),
    neNasheBrandingList: loadNeNasheBrandingList(db),
    neNasheDecorMkList: loadNeNasheDecorMkList(db),
    tipRules: loadTipRules(db),
  };
  cacheAt = Date.now();
  return cache;
}

export function invalidatePatternListsCache() {
  cache = null;
  cacheAt = 0;
}

export function resetPatternListsCacheForTests() {
  invalidatePatternListsCache();
}
