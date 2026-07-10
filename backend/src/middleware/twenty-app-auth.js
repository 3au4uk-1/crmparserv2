import crypto from 'crypto';
import { config } from '../config.js';

export function isTwentyAppAuthRequired() {
  return Boolean(config.twentyAppApiSecret);
}

function tokensMatch(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function verifyTwentyAppSecret(token) {
  if (!isTwentyAppAuthRequired()) return true;
  return tokensMatch(token, config.twentyAppApiSecret);
}

export function twentyAppAuthMiddleware(req, res, next) {
  if (!isTwentyAppAuthRequired()) return next();

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (tokensMatch(token, config.twentyAppApiSecret)) return next();

  res.status(401).json({ error: 'Unauthorized' });
}
