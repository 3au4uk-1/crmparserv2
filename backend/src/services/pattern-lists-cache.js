import { loadBlacklist } from './blacklist.js';
import { loadRestorationList } from './restoration.js';
import { loadTipRules } from './tip-rules.js';

const TTL_MS = 30_000;

let cache = null;
let cacheAt = 0;

export function getCachedPatternLists(db) {
  if (cache && Date.now() - cacheAt < TTL_MS) {
    return cache;
  }

  cache = {
    blacklist: loadBlacklist(db),
    restorationList: loadRestorationList(db),
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
