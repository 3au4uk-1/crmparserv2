import { describe, expect, it } from 'vitest';
import { buildProductStreamContext } from '../src/services/twenty-items.js';
import { planProductStreamBackfill } from '../src/services/product-stream-backfill.js';

const streamContext = buildProductStreamContext({
  brandingKeywords: ['оклейка'],
  decorKeywords: ['стойка'],
  mkKeywords: [],
});

it('adds BRANDING to an existing DECOR wrap that also matches branding', () => {
  const plan = planProductStreamBackfill({
    parserItems: [
      {
        id: 1,
        name: 'Стойка барная Laconismo - внешняя оклейка корупса',
        classification: 'unclassified',
        sync_override: null,
        twenty_id: 'li-1',
      },
    ],
    twentyLineItems: [
      { id: 'li-1', name: 'Стойка барная Laconismo - внешняя оклейка корупса', istochnik: 'PARSER', productStream: 'DECOR' },
    ],
    streamContext,
  });
  expect(plan.toUpdate).toEqual([
    {
      twentyId: 'li-1',
      name: 'Стойка барная Laconismo - внешняя оклейка корупса',
      productStreams: ['DECOR', 'BRANDING'],
    },
  ]);
});

it('wraps manual MK without adding branding from keywords', () => {
  const plan = planProductStreamBackfill({
    parserItems: [],
    twentyLineItems: [
      { id: 'm1', name: 'Стойка барная оклейка', istochnik: 'TWENTY_RUCHNAYA', productStream: 'MK' },
    ],
    streamContext,
  });
  expect(plan.toUpdate).toEqual([
    { twentyId: 'm1', name: 'Стойка барная оклейка', productStreams: ['MK'] },
  ]);
});

it('does not emit updates when the set already matches', () => {
  const plan = planProductStreamBackfill({
    parserItems: [
      {
        id: 1,
        name: 'Баннер 3x6',
        classification: 'keyword_match',
        sync_override: null,
        twenty_id: 'li-2',
      },
    ],
    twentyLineItems: [
      { id: 'li-2', name: 'Баннер 3x6', istochnik: 'PARSER', productStream: ['BRANDING'] },
    ],
    streamContext: buildProductStreamContext({ brandingKeywords: ['баннер'] }),
  });
  expect(plan.toUpdate).toEqual([]);
});
