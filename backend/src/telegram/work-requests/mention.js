function normalizedUsername(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function messageMentionsBot(message, botUsername) {
  const expected = normalizedUsername(botUsername);
  if (!expected) return false;

  const text = message?.text ?? message?.caption ?? '';
  const entities = message?.text != null
    ? message.entities ?? []
    : message?.caption_entities ?? [];

  return entities.some((entity) => {
    if (entity?.type !== 'mention') return false;
    const mention = text.slice(entity.offset, entity.offset + entity.length);
    return normalizedUsername(mention) === expected;
  });
}
