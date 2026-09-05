export function normalizeTelegramChatId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  const tme = value.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/c\/(\d+)/i);
  if (tme) return `-100${tme[1]}`;

  if (/^-\d+$/.test(value)) return value;

  if (/^\d+$/.test(value)) {
    if (value.startsWith('100') && value.length >= 12) return `-${value}`;
    if (value.length >= 8) return `-100${value}`;
  }

  return value;
}

export function chatIdCandidates(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return [];
  return [...new Set([value, normalizeTelegramChatId(value)].filter(Boolean))];
}

export function chatIdsMatch(left, right) {
  const normalized = normalizeTelegramChatId(left);
  return Boolean(normalized) && normalized === normalizeTelegramChatId(right);
}
