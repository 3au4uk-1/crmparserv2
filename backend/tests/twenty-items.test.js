import { describe, it, expect } from 'vitest';
import {
  isItemEligibleForTwenty,
  getItemsForTwenty,
  getItemEligibleReason,
} from '../src/services/twenty-items.js';

describe('twenty-items', () => {
  it('includes keyword_match by default', () => {
    const item = { classification: 'keyword_match', sync_override: null };
    expect(isItemEligibleForTwenty(item)).toBe(true);
    expect(getItemEligibleReason(item)).toBe('keyword_match');
  });

  it('excludes unclassified by default', () => {
    const item = { classification: 'unclassified', sync_override: null };
    expect(isItemEligibleForTwenty(item)).toBe(false);
  });

  it('manual include overrides rejection', () => {
    const item = { classification: 'llm_rejected', sync_override: 'include' };
    expect(isItemEligibleForTwenty(item)).toBe(true);
    expect(getItemEligibleReason(item)).toBe('manual_include');
  });

  it('manual exclude overrides keyword match', () => {
    const item = { classification: 'keyword_match', sync_override: 'exclude' };
    expect(isItemEligibleForTwenty(item)).toBe(false);
  });

  it('matches SQL count logic for null override + keyword_match', () => {
    const items = [
      { classification: 'keyword_match', sync_override: null },
      { classification: 'keyword_match', sync_override: undefined },
      { classification: 'unclassified', sync_override: null },
    ];
    expect(getItemsForTwenty(items).length).toBe(2);
  });

  it('filters list to eligible only', () => {
    const items = [
      { id: 1, classification: 'keyword_match', sync_override: null },
      { id: 2, classification: 'unclassified', sync_override: 'include' },
      { id: 3, classification: 'llm_confirmed', sync_override: 'exclude' },
    ];
    expect(getItemsForTwenty(items).map((i) => i.id)).toEqual([1, 2]);
  });
});
