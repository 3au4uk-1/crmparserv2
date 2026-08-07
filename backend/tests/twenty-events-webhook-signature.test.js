// backend/tests/twenty-events-webhook-signature.test.js
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_TOLERANCE_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signTwentyWebhookPayload,
  verifyTwentyWebhookSignature,
} from '../src/services/twenty-events/webhook-signature.js';

const SECRET = 'webhook-secret';
const NOW = 1_780_000_000_000;
const BODY = '{"eventName":"opportunity.updated","record":{"id":"opp-1"}}';

const validArgs = (overrides = {}) => {
  const timestampHeader = String(NOW);
  return {
    rawBody: BODY,
    timestampHeader,
    signatureHeader: signTwentyWebhookPayload(BODY, timestampHeader, SECRET),
    secret: SECRET,
    now: NOW,
    ...overrides,
  };
};

describe('webhook signature contract', () => {
  it('uses the header names and tolerance Twenty expects', () => {
    expect(SIGNATURE_HEADER).toBe('x-twenty-webhook-signature');
    expect(TIMESTAMP_HEADER).toBe('x-twenty-webhook-timestamp');
    expect(DEFAULT_TOLERANCE_MS).toBe(300_000);
  });

  it('signs "<timestamp>:<body>" with HMAC SHA256 in hex', () => {
    const signature = signTwentyWebhookPayload('body', '123', SECRET);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).not.toBe(signTwentyWebhookPayload('body', '124', SECRET));
  });
});

describe('verifyTwentyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(verifyTwentyWebhookSignature(validArgs())).toEqual({ ok: true });
  });

  it('accepts an upper-case signature header', () => {
    const args = validArgs();

    expect(
      verifyTwentyWebhookSignature({
        ...args,
        signatureHeader: args.signatureHeader.toUpperCase(),
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a tampered body', () => {
    expect(
      verifyTwentyWebhookSignature(validArgs({ rawBody: `${BODY} ` })),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a signature of the wrong length or shape', () => {
    expect(verifyTwentyWebhookSignature(validArgs({ signatureHeader: 'abc' }))).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(
      verifyTwentyWebhookSignature(validArgs({ signatureHeader: 'z'.repeat(64) })),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a timestamp outside the tolerance window', () => {
    expect(
      verifyTwentyWebhookSignature(validArgs({ now: NOW + DEFAULT_TOLERANCE_MS + 1 })),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('accepts a timestamp inside the tolerance window, in either direction', () => {
    expect(
      verifyTwentyWebhookSignature(validArgs({ now: NOW + DEFAULT_TOLERANCE_MS })),
    ).toEqual({ ok: true });
    expect(
      verifyTwentyWebhookSignature(validArgs({ now: NOW - DEFAULT_TOLERANCE_MS })),
    ).toEqual({ ok: true });
  });

  it('reports what was missing or malformed', () => {
    expect(verifyTwentyWebhookSignature(validArgs({ secret: '' })).reason).toBe('missing_secret');
    expect(verifyTwentyWebhookSignature(validArgs({ signatureHeader: undefined })).reason).toBe(
      'missing_signature',
    );
    expect(verifyTwentyWebhookSignature(validArgs({ timestampHeader: undefined })).reason).toBe(
      'missing_timestamp',
    );
    expect(verifyTwentyWebhookSignature(validArgs({ timestampHeader: 'not-a-number' })).reason).toBe(
      'invalid_timestamp',
    );
  });
});
