import crypto from 'crypto';
import { config } from '../config.js';

export function isImportAuthRequired() {
  return Boolean(config.importApiSecret);
}

function tokensMatch(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function importAuthMiddleware(req, res, next) {
  if (!isImportAuthRequired()) return next();

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (tokensMatch(token, config.importApiSecret)) return next();

  res.status(401).json({ ok: false, error: 'Unauthorized' });
}
