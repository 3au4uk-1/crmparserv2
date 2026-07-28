import { describe, it, expect } from 'vitest';
import {
  isItemEligibleForTwenty,
  getItemsForTwenty,
  getItemEligibleReason,
  enrichDealItems,
  buildProductStreamContext,
  resolveItemProductStream,
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

  it('manual_twenty with include is eligible via sync_override', () => {
    const items = [{ name: 'X', classification: 'manual_twenty', sync_override: 'include' }];
    expect(getItemsForTwenty(items)).toHaveLength(1);
  });

  it('manual_twenty with exclude is not eligible', () => {
    const items = [{ name: 'X', classification: 'manual_twenty', sync_override: 'exclude' }];
    expect(getItemsForTwenty(items)).toHaveLength(0);
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

describe('enrichDealItems restoration', () => {
  const restorationList = [{ id: 1, pattern: 'колесо фортуны', matchType: 'exact' }];
  const deal = { data_source: 'tony' };

  it('adds restorationMatch and zero twentyLineAmount for eligible match', () => {
    const items = [
      {
        id: 1,
        name: 'Колесо фортуны',
        price: 18900,
        quantity: '1',
        sum: 18900,
        classification: 'keyword_match',
        sync_override: null,
      },
    ];
    const enriched = enrichDealItems(items, [], restorationList, deal);
    expect(enriched[0].restorationMatch).toBe(true);
    expect(enriched[0].twentyLineAmount).toBe(0);
    expect(enriched[0].eligibleForTwenty).toBe(true);
  });

  it('does not change eligibility for ineligible item even if name matches', () => {
    const items = [
      {
        id: 1,
        name: 'Колесо фортуны',
        price: 18900,
        quantity: '1',
        sum: 18900,
        classification: 'unclassified',
        sync_override: null,
      },
    ];
    expect(getItemsForTwenty(items, [], restorationList)).toEqual([]);
    const enriched = enrichDealItems(items, [], restorationList, deal);
    expect(enriched[0].restorationMatch).toBe(true);
    expect(enriched[0].eligibleForTwenty).toBe(false);
    expect(enriched[0].twentyLineAmount).toBe(0);
  });
});

describe('enrichDealItems tip rules', () => {
  const items = [{
    id: 1,
    name: 'Баннер 3x6',
    price: 1000,
    quantity: '1',
    classification: 'keyword_match',
    sync_override: null,
  }];

  it('exposes the unified tip-rule match and derives legacy UI flags', () => {
    const tipRules = [{
      id: 7,
      pattern: 'баннер',
      matchType: 'substring',
      tip: 'BANNERA',
      tipDetail: 'INTERER',
      priority: 50,
    }];

    const [enriched] = enrichDealItems(items, [], [], null, tipRules);

    expect(enriched.tipRuleMatch).toBe(true);
    expect(enriched.tipRuleMatchEntry).toEqual({
      id: 7,
      pattern: 'баннер',
      matchType: 'substring',
      tip: 'BANNERA',
      tipDetail: 'INTERER',
    });
    expect(enriched.podryadMatch).toBe(false);
    expect(enriched.bannerMatch).toBe(true);
  });

  it('returns null match metadata and false legacy flags when unmatched', () => {
    const [enriched] = enrichDealItems(items, [], [], null, []);

    expect(enriched.tipRuleMatch).toBe(false);
    expect(enriched.tipRuleMatchEntry).toBeNull();
    expect(enriched.podryadMatch).toBe(false);
    expect(enriched.bannerMatch).toBe(false);
  });
});

describe('product stream eligibility', () => {
  const streamContext = buildProductStreamContext({
    brandingKeywords: ['баннер'],
    decorKeywords: ['шары'],
    mkKeywords: ['мк'],
    decorBlacklist: [{ id: 1, pattern: 'шары запрет', matchType: 'exact' }],
    mkBlacklist: [{ id: 2, pattern: 'мк запрет', matchType: 'exact' }],
  });

  it('includes decor keyword match even when unclassified', () => {
    const item = { name: 'Оформление шары', classification: 'unclassified', sync_override: null };
    expect(isItemEligibleForTwenty(item, streamContext)).toBe(true);
    expect(resolveItemProductStream(item, streamContext)).toBe('DECOR');
    expect(getItemEligibleReason(item, streamContext)).toBe('decor_keyword');
  });

  it('includes mk keyword match with mk reason', () => {
    const item = { name: 'МК лепка', classification: 'unclassified', sync_override: null };
    expect(resolveItemProductStream(item, streamContext)).toBe('MK');
    expect(getItemEligibleReason(item, streamContext)).toBe('mk_keyword');
  });

  it('excludes decor-blacklisted decor match', () => {
    const item = { name: 'Шары запрет', classification: 'unclassified', sync_override: null };
    expect(isItemEligibleForTwenty(item, streamContext)).toBe(false);
  });

  it('getItemsForTwenty attaches productStream', () => {
    const items = [
      { id: 1, name: 'Оформление шары', classification: 'unclassified', sync_override: null },
      { id: 2, name: 'Кейтеринг', classification: 'unclassified', sync_override: null },
    ];
    const eligible = getItemsForTwenty(items, streamContext);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].productStream).toBe('DECOR');
  });

  it('enrichDealItems adds decorBlacklisted and mkBlacklisted flags', () => {
    const items = [
      { id: 1, name: 'Шары запрет', classification: 'unclassified', sync_override: null },
      { id: 2, name: 'МК запрет', classification: 'unclassified', sync_override: null },
    ];
    const enriched = enrichDealItems(items, streamContext);
    expect(enriched[0].decorBlacklisted).toBe(true);
    expect(enriched[0].mkBlacklisted).toBe(false);
    expect(enriched[1].decorBlacklisted).toBe(false);
    expect(enriched[1].mkBlacklisted).toBe(true);
  });

  it('preserves branding keyword_match eligibility via legacy fallback', () => {
    const item = { name: 'Баннер 3x6', classification: 'keyword_match', sync_override: null };
    expect(isItemEligibleForTwenty(item, streamContext)).toBe(true);
    expect(resolveItemProductStream(item, streamContext)).toBe('BRANDING');
  });

  it('preserves llm_confirmed eligibility as BRANDING when no stream keyword matches', () => {
    const item = { name: 'Custom branding item', classification: 'llm_confirmed', sync_override: null };
    expect(isItemEligibleForTwenty(item, streamContext)).toBe(true);
    expect(resolveItemProductStream(item, streamContext)).toBe('BRANDING');
    expect(getItemEligibleReason(item, streamContext)).toBe('llm_confirmed');
  });
});
