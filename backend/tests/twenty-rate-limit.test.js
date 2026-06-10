import { describe, it, expect } from 'vitest';
import {
  isTwentyRateLimitError,
  parseTwentyRateLimitWaitMs,
} from '../src/services/twenty-rate-limit.js';

describe('twenty-rate-limit', () => {
  it('detects Twenty rate limit messages', () => {
    expect(
      isTwentyRateLimitError('Limit reached (100 tokens per 60000 ms)')
    ).toBe(true);
    expect(isTwentyRateLimitError('Something else')).toBe(false);
  });

  it('parses wait window from error message', () => {
    expect(parseTwentyRateLimitWaitMs('Limit reached (100 tokens per 60000 ms)')).toBe(60500);
  });
});
