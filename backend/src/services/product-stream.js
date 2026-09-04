import { keywordMatchesItemName } from './classifier.js';
import { isBlacklisted } from './blacklist.js';

const STREAM_ORDER = ['MK', 'DECOR', 'BRANDING'];

function matchesAnyKeyword(name, keywords = []) {
  return keywords.some((keyword) => keywordMatchesItemName(name, keyword));
}

export function sortProductStreams(streams = []) {
  const present = new Set(streams.filter((stream) => STREAM_ORDER.includes(stream)));
  return STREAM_ORDER.filter((stream) => present.has(stream));
}

export function coerceProductStreams(raw) {
  if (Array.isArray(raw)) return sortProductStreams(raw);
  if (raw === 'MK' || raw === 'DECOR' || raw === 'BRANDING') return [raw];
  return [];
}

export function productStreamsEqual(a, b) {
  const left = sortProductStreams(a);
  const right = sortProductStreams(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
  const streams = [];
  if (matchesAnyKeyword(name, mkKeywords) && !isBlacklisted(name, mkBlacklist)) {
    streams.push('MK');
  }
  if (matchesAnyKeyword(name, decorKeywords) && !isBlacklisted(name, decorBlacklist)) {
    streams.push('DECOR');
  }
  if (
    matchesAnyKeyword(name, brandingKeywords) &&
    !isBlacklisted(name, brandingBlacklist)
  ) {
    streams.push('BRANDING');
  }
  return sortProductStreams(streams);
}
