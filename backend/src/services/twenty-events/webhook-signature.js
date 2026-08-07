// backend/src/services/twenty-events/webhook-signature.js
import crypto from 'node:crypto';

export const SIGNATURE_HEADER = 'x-twenty-webhook-signature';
export const TIMESTAMP_HEADER = 'x-twenty-webhook-timestamp';
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

const HEX_64 = /^[0-9a-f]{64}$/;

/** Mirrors Twenty's CallWebhookJob: HMAC SHA256 over `<timestamp>:<raw body>`. */
export function signTwentyWebhookPayload(rawBody, timestamp, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}:${rawBody}`).digest('hex');
}

export function verifyTwentyWebhookSignature({
  rawBody,
  timestampHeader,
  signatureHeader,
  secret,
  now = Date.now(),
  toleranceMs = DEFAULT_TOLERANCE_MS,
}) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid_timestamp' };
  if (Math.abs(now - timestamp) > toleranceMs) return { ok: false, reason: 'stale_timestamp' };

  const received = String(signatureHeader).trim().toLowerCase();
  if (!HEX_64.test(received)) return { ok: false, reason: 'invalid_signature' };

  const expected = signTwentyWebhookPayload(rawBody, timestampHeader, secret);
  const matches = crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received, 'hex'),
  );

  return matches ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}
