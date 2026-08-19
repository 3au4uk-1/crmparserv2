import { describe, it, expect } from 'vitest';
import { classifyByKeywords, keywordMatchesItemName } from '../src/services/classifier.js';
import { buildTonyItems } from '../src/services/tony-mapping.js';

const keywords = ['брендинг', 'баннер', 'печать', 'наклейка', 'логотип'];

describe('classifyByKeywords', () => {
  it('matches exact keyword in item name', () => {
    const result = classifyByKeywords(
      [{ name: 'Брендинг стены', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('keyword_match');
  });

  it('matches partial keyword (баннер in баннера)', () => {
    const result = classifyByKeywords(
      [{ name: 'Монтаж стенок (баннера)', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('keyword_match');
  });

  it('marks non-matching items as unclassified', () => {
    const result = classifyByKeywords(
      [{ name: 'Шатер Кайт 4х4', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('unclassified');
  });

  it('is case-insensitive', () => {
    const result = classifyByKeywords(
      [{ name: 'ПЕЧАТЬ на баннере', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('keyword_match');
  });

  it('does not match keyword inside another word', () => {
    expect(keywordMatchesItemName('цыплёнка', 'плёнка')).toBe(false);
    expect(keywordMatchesItemName('антипленка защитная', 'пленка')).toBe(false);
  });

  it('still matches keyword at word start after delimiter', () => {
    expect(keywordMatchesItemName('Плёнка ПВХ 3мм', 'плёнка')).toBe(true);
    expect(keywordMatchesItemName('Монтаж (пленка)', 'плёнка')).toBe(true);
    expect(keywordMatchesItemName('Монтаж стенок (баннера)', 'баннер')).toBe(true);
  });

  it('processes multiple items', () => {
    const items = [
      { name: 'Брендинг стены', price: 100 },
      { name: 'Шатер Кайт 4х4', price: 200 },
      { name: 'Наклейка на стенд', price: 50 },
    ];
    const result = classifyByKeywords(items, keywords);
    expect(result[0].classification).toBe('keyword_match');
    expect(result[1].classification).toBe('unclassified');
    expect(result[2].classification).toBe('keyword_match');
  });
});

describe('classifyByKeywords free-entry whitelist', () => {
  const keywords = ['брендинг', 'баннер', 'печать', 'наклейка', 'логотип'];
  const FREE_ENTRY_NAME =
    'БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )';

  it('forces keyword_match when isFreeEntry is set even if name has no keyword', () => {
    const result = classifyByKeywords(
      [{ name: 'на тележку по смете', isFreeEntry: true, price: 16000 }],
      keywords,
    );
    expect(result[0].classification).toBe('keyword_match');
    expect(result[0].classification_confidence).toBe(1.0);
    expect(result[0].name).toBe('на тележку по смете');
  });

  it('still marks the same name unclassified without the flag', () => {
    const result = classifyByKeywords(
      [{ name: 'на тележку по смете', price: 16000 }],
      keywords,
    );
    expect(result[0].classification).toBe('unclassified');
  });

  it('buildTonyItems free-entry rows classify as keyword_match', () => {
    const items = buildTonyItems({
      items: [
        {
          name: FREE_ENTRY_NAME,
          price: 16000,
          quantity: '1',
          discount: 0,
          sum: 16000,
          comment: 'на тележку по смете',
        },
        {
          name: FREE_ENTRY_NAME,
          price: 100,
          quantity: '1',
          discount: 0,
          sum: 100,
          comment: 'Макет',
        },
        {
          name: FREE_ENTRY_NAME,
          price: 200,
          quantity: '1',
          discount: 0,
          sum: 200,
          comment: 'Макет',
        },
      ],
      dates: {},
    });
    const result = classifyByKeywords(items, keywords);
    expect(result.map((i) => i.name)).toEqual([
      'на тележку по смете',
      'Макет',
      'Макет (#2)',
    ]);
    expect(result.every((i) => i.classification === 'keyword_match')).toBe(true);
    expect(result.every((i) => i.classification_confidence === 1.0)).toBe(true);
  });
});
