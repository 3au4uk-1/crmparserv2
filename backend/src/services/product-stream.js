import { keywordMatchesItemName } from './classifier.js';
import { isBlacklisted } from './blacklist.js';

function matchesAnyKeyword(name, keywords = []) {
  return keywords.some((keyword) => keywordMatchesItemName(name, keyword));
}

export function classifyProductStream({
  name,
  brandingKeywords = [],
  decorKeywords = [],
  mkKeywords = [],
  brandingBlacklist = [],
  decorBlacklist = [],
  mkBlacklist = [],
}) {
  if (matchesAnyKeyword(name, mkKeywords) && !isBlacklisted(name, mkBlacklist)) {
    return 'MK';
  }

  if (matchesAnyKeyword(name, decorKeywords) && !isBlacklisted(name, decorBlacklist)) {
    return 'DECOR';
  }

  if (
    matchesAnyKeyword(name, brandingKeywords) &&
    !isBlacklisted(name, brandingBlacklist)
  ) {
    return 'BRANDING';
  }

  return null;
}
