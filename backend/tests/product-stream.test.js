import { describe, it, expect } from 'vitest';
import { classifyProductStream } from '../src/services/product-stream.js';

const brandingKeywords = ['баннер', 'брендинг', 'печать'];
const decorKeywords = ['декор', 'цветы', 'шары'];
const mkKeywords = ['мк', 'мастер-класс'];

const brandingBlacklist = [{ pattern: 'тест баннер', matchType: 'substring' }];
const decorBlacklist = [{ pattern: 'тест декор', matchType: 'substring' }];
const mkBlacklist = [{ pattern: 'тест мк', matchType: 'substring' }];

describe('classifyProductStream', () => {
  it('returns MK when mk keywords match and not mk-blacklisted', () => {
    expect(
      classifyProductStream({
        name: 'МК по лепке',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('MK');
  });

  it('returns DECOR when decor keywords match and not decor-blacklisted', () => {
    expect(
      classifyProductStream({
        name: 'Оформление шары',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('DECOR');
  });

  it('returns BRANDING when branding keywords match and not branding-blacklisted', () => {
    expect(
      classifyProductStream({
        name: 'Печать на баннере',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('BRANDING');
  });

  it('prioritizes MK over DECOR and branding when multiple keyword sets match', () => {
    expect(
      classifyProductStream({
        name: 'МК и баннер с декором',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('MK');
  });

  it('prioritizes DECOR over branding when both match and MK does not', () => {
    expect(
      classifyProductStream({
        name: 'Баннер с декором',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('DECOR');
  });

  it('returns null when no keyword sets match', () => {
    expect(
      classifyProductStream({
        name: 'Шатер Кайт 4х4',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBeNull();
  });

  it('returns null when mk matches but is mk-blacklisted and no lower-priority stream matches', () => {
    expect(
      classifyProductStream({
        name: 'Тест МК по рисованию',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBeNull();
  });

  it('falls through to DECOR when mk matches but is mk-blacklisted', () => {
    expect(
      classifyProductStream({
        name: 'Тест МК и шары',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('DECOR');
  });

  it('falls through to BRANDING when mk and decor match but are blacklisted', () => {
    expect(
      classifyProductStream({
        name: 'Тест МК тест декор и баннер',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBe('BRANDING');
  });

  it('returns null when branding matches but is branding-blacklisted', () => {
    expect(
      classifyProductStream({
        name: 'Тест баннер для выставки',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBeNull();
  });

  it('returns null when decor matches but is decor-blacklisted and no other stream matches', () => {
    expect(
      classifyProductStream({
        name: 'Тест декор стола',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      })
    ).toBeNull();
  });

  it('uses word-boundary keyword matching from classifier', () => {
    expect(
      classifyProductStream({
        name: 'антипленка защитная',
        brandingKeywords: ['пленка'],
        decorKeywords: [],
        mkKeywords: [],
        brandingBlacklist: [],
        decorBlacklist: [],
        mkBlacklist: [],
      })
    ).toBeNull();

    expect(
      classifyProductStream({
        name: 'Плёнка ПВХ 3мм',
        brandingKeywords: ['плёнка'],
        decorKeywords: [],
        mkKeywords: [],
        brandingBlacklist: [],
        decorBlacklist: [],
        mkBlacklist: [],
      })
    ).toBe('BRANDING');
  });

  it('handles empty keyword lists', () => {
    expect(
      classifyProductStream({
        name: 'Любая позиция',
        brandingKeywords: [],
        decorKeywords: [],
        mkKeywords: [],
        brandingBlacklist: [],
        decorBlacklist: [],
        mkBlacklist: [],
      })
    ).toBeNull();
  });
});
