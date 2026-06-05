import { describe, it, expect } from 'vitest';
import { classifyByKeywords, keywordMatchesItemName } from '../src/services/classifier.js';

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
