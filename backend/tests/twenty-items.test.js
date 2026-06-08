import { describe, it, expect } from 'vitest';
import {
  isItemEligibleForTwenty,
  getItemsForTwenty,
  getItemEligibleReason,
} from '../src/services/twenty-items.js';

const blacklist = [
  { id: 1, pattern: 'стойка указатель напольная а4', matchType: 'exact' },
];

describe('twenty-items', () => {
  it('includes keyword_match by default', () => {
    const item = { name: 'Баннер 3x6', classification: 'keyword_match', sync_override: null };
    expect(isItemEligibleForTwenty(item)).toBe(true);
    expect(getItemEligibleReason(item)).toBe('keyword_match');
  });

  it('excludes unclassified by default', () => {
    const item = { name: 'Кейтеринг', classification: 'unclassified', sync_override: null };
    expect(isItemEligibleForTwenty(item)).toBe(false);
  });

  it('manual include overrides rejection', () => {
    const item = { name: 'Печать', classification: 'llm_rejected', sync_override: 'include' };
    expect(isItemEligibleForTwenty(item)).toBe(true);
    expect(getItemEligibleReason(item)).toBe('manual_include');
  });

  it('manual exclude overrides keyword match', () => {
    const item = { name: 'Баннер', classification: 'keyword_match', sync_override: 'exclude' };
    expect(isItemEligibleForTwenty(item)).toBe(false);
  });

  it('matches SQL count logic for null override + keyword_match', () => {
    const items = [
      { name: 'a', classification: 'keyword_match', sync_override: null },
      { name: 'b', classification: 'keyword_match', sync_override: undefined },
      { name: 'c', classification: 'unclassified', sync_override: null },
    ];
    expect(getItemsForTwenty(items).length).toBe(2);
  });

  it('filters list to eligible only', () => {
    const items = [
      { id: 1, name: 'a', classification: 'keyword_match', sync_override: null },
      { id: 2, name: 'b', classification: 'unclassified', sync_override: 'include' },
      { id: 3, name: 'c', classification: 'llm_confirmed', sync_override: 'exclude' },
    ];
    expect(getItemsForTwenty(items).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe('blacklist eligibility', () => {
  it('keyword_match + blacklisted → not eligible', () => {
    const item = {
      name: 'Стойка указатель напольная А4',
      classification: 'keyword_match',
      sync_override: null,
    };
    expect(isItemEligibleForTwenty(item, blacklist)).toBe(false);
  });

  it('manual include overrides blacklist', () => {
    const item = {
      name: 'Стойка указатель напольная А4',
      classification: 'keyword_match',
      sync_override: 'include',
    };
    expect(isItemEligibleForTwenty(item, blacklist)).toBe(true);
  });

  it('manual exclude still blocks before blacklist check', () => {
    const item = {
      name: 'Баннер 3x6',
      classification: 'keyword_match',
      sync_override: 'exclude',
    };
    expect(isItemEligibleForTwenty(item, blacklist)).toBe(false);
  });
});
