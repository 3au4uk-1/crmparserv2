/**
 * Parse /завтра and /послезавтра bot commands.
 * @param {string} text
 * @returns {1 | 2 | null} offsetDays for digest, or null if not a digest command
 */
export function parseDigestCommand(text) {
  const t = (text || '').trim();
  if (/^\/послезавтра(?:@[^\s]+)?$/i.test(t)) return 2;
  if (/^\/завтра(?:@[^\s]+)?$/i.test(t)) return 1;
  return null;
}
