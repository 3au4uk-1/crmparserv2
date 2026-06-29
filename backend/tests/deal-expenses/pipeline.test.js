import { describe, it, expect } from 'vitest';
import {
  runDealCentricPipeline,
  shouldSkipSheet,
  aggregateDealsForTargets,
} from '../../src/services/deal-expenses/pipeline.js';

describe('runDealCentricPipeline', () => {
  it('keeps only records matching target deal IDs', () => {
    const records = [
      { deal_id: '111', source: 'printing', amount: 100, tab: 'A' },
      { deal_id: '222', source: 'printing', amount: 50, tab: 'B' },
      { deal_id: '111', source: 'milling', amount: 30, tab: 'C' },
    ];
    const result = aggregateDealsForTargets(records, ['111'], ['printing', 'milling']);
    expect(result).toHaveLength(1);
    expect(result[0].deal_id).toBe('111');
    expect(result[0].amounts.printing).toBe(100);
    expect(result[0].amounts.milling).toBe(30);
  });

  it('sums same deal across multiple tabs (no month filter)', () => {
    const records = [
      { deal_id: '111', source: 'printing', amount: 100, tab: 'МАЙ 2026' },
      { deal_id: '111', source: 'printing', amount: 200, tab: 'ИЮНЬ 2026' },
    ];
    const result = aggregateDealsForTargets(records, ['111'], ['printing']);
    expect(result[0].amounts.printing).toBe(300);
  });

  it('shouldSkipSheet skips junk tabs only', () => {
    const patterns = ['^болванка', 'копия'];
    expect(shouldSkipSheet('Болванка май', patterns)).toBe(true);
    expect(shouldSkipSheet('МАЙ 2026', patterns)).toBe(false);
  });

  it('runDealCentricPipeline ensures zero amounts for targets with no data', () => {
    const result = runDealCentricPipeline({
      sources: {
        printing: { type: 'row_layout' },
        milling: { type: 'row_layout' },
      },
      targetDealIds: ['111', '222'],
      skipSheetPatterns: [],
      readSource: () => ({
        SheetNames: [],
        name: 'test',
        getSheetMeta: () => ({ data: [], sheet: null, hyperlinks: new Map() }),
      }),
    });

    expect(result.deals).toHaveLength(2);
    const deal111 = result.deals.find((d) => d.deal_id === '111');
    const deal222 = result.deals.find((d) => d.deal_id === '222');
    expect(deal111.amounts.printing).toBe(0);
    expect(deal111.amounts.milling).toBe(0);
    expect(deal222.amounts.printing).toBe(0);
    expect(deal222.amounts.milling).toBe(0);
  });
});
