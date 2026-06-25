import crypto from 'crypto';
import { config } from '../config.js';

const TOKEN_PREFIX = 'crm-parser-auth';

export function isAuthRequired() {
  return Boolean(config.appPassword);
}

export function isImportAuthRequired() {
  return Boolean(config.importApiSecret);
}

export function createSessionToken() {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${TOKEN_PREFIX}:${config.appPassword}`)
    .digest('hex');
}

function tokensMatch(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function verifySessionToken(token) {
  if (!isAuthRequired()) return true;
  return tokensMatch(token, createSessionToken());
}

export function verifyImportSecret(token) {
  if (!isImportAuthRequired()) return true;
  return tokensMatch(token, config.importApiSecret);
}

export function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

export function appAuthMiddleware(req, res, next) {
  const token = extractBearerToken(req);

  // Service-to-service: Brandogram → import-by-booking (bypass UI session token)
  if (req.path === '/deals/import-by-booking' && req.method === 'POST') {
    if (verifyImportSecret(token)) return next();
    if (!isImportAuthRequired()) return next();
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  if (!isAuthRequired()) return next();

  if (verifySessionToken(token)) return next();

  res.status(401).json({ error: 'Unauthorized' });
}
