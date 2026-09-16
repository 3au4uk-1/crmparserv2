import { describe, expect, it } from 'vitest';
import { isTelegramPollingEnabled } from '../src/telegram/polling-flag.js';

describe('isTelegramPollingEnabled', () => {
  it('defaults on when the env value is missing or empty', () => {
    expect(isTelegramPollingEnabled(undefined)).toBe(true);
    expect(isTelegramPollingEnabled('')).toBe(true);
    expect(isTelegramPollingEnabled('  ')).toBe(true);
  });

  it('stays on for explicit truthy values', () => {
    expect(isTelegramPollingEnabled('true')).toBe(true);
    expect(isTelegramPollingEnabled('1')).toBe(true);
    expect(isTelegramPollingEnabled('yes')).toBe(true);
  });

  it('turns off only when explicitly disabled', () => {
    expect(isTelegramPollingEnabled('false')).toBe(false);
    expect(isTelegramPollingEnabled('0')).toBe(false);
    expect(isTelegramPollingEnabled('no')).toBe(false);
  });
});
