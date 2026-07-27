import { normalizePattern } from './blacklist.js';

export function matchesTipRule(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findTipRuleMatch(itemName, rules = []) {
  const sorted = [...rules].sort((a, b) => {
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
  for (const entry of sorted) {
    if (matchesTipRule(itemName, entry)) return entry;
  }
  return null;
}
