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
    ).toEqual(['MK']);
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
    ).toEqual(['DECOR']);
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
    ).toEqual(['BRANDING']);
  });

  it('returns MK, DECOR, and BRANDING when all match', () => {
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
    ).toEqual(['MK', 'DECOR', 'BRANDING']);
  });

  it('returns both DECOR and BRANDING when both keyword sets match', () => {
    expect(
      classifyProductStream({
        name: 'Стойка барная Laconismo - внешняя оклейка корупса',
        brandingKeywords: ['оклейка', 'брендинг'],
        decorKeywords: ['стойка'],
        mkKeywords: ['мк'],
        brandingBlacklist: [],
        decorBlacklist: [],
        mkBlacklist: [],
      }),
    ).toEqual(['DECOR', 'BRANDING']);
  });

  it('returns DECOR and BRANDING when both match and MK does not', () => {
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
    ).toEqual(['DECOR', 'BRANDING']);
  });

  it('returns empty array when no keyword sets match', () => {
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
    ).toEqual([]);
  });

  it('returns empty array when mk matches but is mk-blacklisted and no other stream matches', () => {
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
    ).toEqual([]);
  });

  it('keeps BRANDING when MK is blacklisted but branding keywords match', () => {
    expect(
      classifyProductStream({
        name: 'Тест МК и баннер',
        brandingKeywords,
        decorKeywords,
        mkKeywords,
        brandingBlacklist,
        decorBlacklist,
        mkBlacklist,
      }),
    ).toEqual(['BRANDING']);
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
    ).toEqual(['DECOR']);
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
    ).toEqual(['BRANDING']);
  });

  it('returns empty array when branding matches but is branding-blacklisted', () => {
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
    ).toEqual([]);
  });

  it('returns empty array when decor matches but is decor-blacklisted and no other stream matches', () => {
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
    ).toEqual([]);
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
    ).toEqual([]);

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
    ).toEqual(['BRANDING']);
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
    ).toEqual([]);
  });
});
