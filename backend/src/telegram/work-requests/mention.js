function normalizedUsername(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textMentionsBot(text, expected) {
  if (!text || !expected) return false;
  const pattern = new RegExp(`(^|[^a-zA-Z0-9_])@${escapeRegExp(expected)}(?![a-zA-Z0-9_])`, 'i');
  return pattern.test(text);
}

export function messageMentionsBot(message, botUsername) {
  const expected = normalizedUsername(botUsername);
  if (!expected) return false;

  const text = message?.text ?? message?.caption ?? '';
  const entities = message?.text != null
    ? message.entities ?? []
    : message?.caption_entities ?? [];

  const viaEntity = entities.some((entity) => {
    if (entity?.type !== 'mention') return false;
    const mention = text.slice(entity.offset, entity.offset + entity.length);
    return normalizedUsername(mention) === expected;
  });
  return viaEntity || textMentionsBot(text, expected);
}
