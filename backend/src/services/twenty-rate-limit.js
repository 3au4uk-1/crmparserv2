import { config } from '../config.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const requestTimestamps = [];

export function isTwentyRateLimitError(message) {
  return /limit reached/i.test(message || '') || /tokens per/i.test(message || '');
}

export function parseTwentyRateLimitWaitMs(message) {
  const match = String(message || '').match(/(\d+)\s*ms/i);
  return (match ? parseInt(match[1], 10) : config.twentyApiRateLimitWindowMs) + 500;
}

/** Sliding window: wait until a Twenty API request slot is available. */
export async function acquireTwentyRateLimitSlot() {
  const windowMs = config.twentyApiRateLimitWindowMs;
  const maxRequests = config.twentyApiRateLimitMax;

  while (true) {
    const now = Date.now();
    while (requestTimestamps.length > 0 && requestTimestamps[0] <= now - windowMs) {
      requestTimestamps.shift();
    }

    if (requestTimestamps.length < maxRequests) {
      requestTimestamps.push(now);
      return;
    }

    const waitMs = requestTimestamps[0] + windowMs - now + 50;
    await delay(waitMs);
  }
}
