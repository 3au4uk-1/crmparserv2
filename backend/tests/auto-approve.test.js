import { describe, it, expect } from 'vitest';
import { shouldAutoApproveDeal } from '../src/services/auto-approve.js';

const blacklist = [];

describe('shouldAutoApproveDeal', () => {
  it('returns false in manual mode', () => {
    const items = [{ name: 'Баннер', classification: 'keyword_match', sync_override: null }];
    expect(shouldAutoApproveDeal(items, blacklist, 'manual')).toBe(false);
  });

  it('semi: approves deals with eligible keyword_match', () => {
    const items = [{ name: 'Баннер', classification: 'keyword_match', sync_override: null }];
    expect(shouldAutoApproveDeal(items, blacklist, 'semi')).toBe(true);
  });

  it('semi: skips deals with only llm_confirmed', () => {
    const items = [{ name: 'Стенд', classification: 'llm_confirmed', sync_override: null }];
    expect(shouldAutoApproveDeal(items, blacklist, 'semi')).toBe(false);
  });

  it('semi: skips deals with only unclassified items', () => {
    const items = [{ name: 'Кейтеринг', classification: 'unclassified', sync_override: null }];
    expect(shouldAutoApproveDeal(items, blacklist, 'semi')).toBe(false);
  });

  it('auto: approves keyword_match deals', () => {
    const items = [{ name: 'Баннер', classification: 'keyword_match', sync_override: null }];
    expect(shouldAutoApproveDeal(items, blacklist, 'auto')).toBe(true);
  });

  it('auto: approves manual include without keyword_match', () => {
    const items = [{ name: 'Печать', classification: 'unclassified', sync_override: 'include' }];
    expect(shouldAutoApproveDeal(items, blacklist, 'auto')).toBe(true);
  });

  it('auto: skips deals with only llm_confirmed', () => {
    const items = [{ name: 'Стенд', classification: 'llm_confirmed', sync_override: null }];
    expect(shouldAutoApproveDeal(items, blacklist, 'auto')).toBe(false);
  });

  it('semi: keyword_match among mixed items is enough', () => {
    const items = [
      { name: 'Баннер', classification: 'keyword_match', sync_override: null },
      { name: 'Кейтеринг', classification: 'unclassified', sync_override: null },
    ];
    expect(shouldAutoApproveDeal(items, blacklist, 'semi')).toBe(true);
  });
});
