import { describe, it, expect } from 'vitest';
import {
  extractSoftTokens,
  datesWithinWindow,
  suggestDealGroups,
} from '../src/services/deal-group-suggest.js';

describe('extractSoftTokens', () => {
  it('drops company codes, dates, and booking numbers', () => {
    const tokens = extractSoftTokens('ПРО/Для оплаты А7 // Ирина // 189820/Титова');
    expect(tokens).toContain('а7');
    expect(tokens).not.toContain('про');
    expect(tokens).not.toContain('189820');
  });
});

describe('datesWithinWindow', () => {
  it('returns true within ±2 days', () => {
    expect(datesWithinWindow('2026-09-01', '2026-09-02')).toBe(true);
    expect(datesWithinWindow('2026-09-01', '2026-09-04')).toBe(false);
  });
});

describe('suggestDealGroups', () => {
  it('hard-groups two deals that share a booking number', () => {
    const { hard } = suggestDealGroups([
      { id: 1, bookingNumbers: ['111111'], bitrixIds: ['A'], title: 'оплата 111111', manager_name: 'Титова', load_date: '2026-09-01' },
      { id: 2, bookingNumbers: ['111111'], bitrixIds: ['B'], title: 'бронь 111111', manager_name: 'Титова', load_date: '2026-09-01' },
    ]);
    expect(hard[0].dealIds.sort()).toEqual([1, 2]);
    expect(hard[0].reason).toBe('shared_booking');
  });

  it('hard-groups all bookings from one multi-number title', () => {
    const { hard } = suggestDealGroups([
      { id: 1, bookingNumbers: ['181289', '178134'], bitrixIds: ['X'], title: 'Кейт 181289+178134', manager_name: 'М', load_date: '2026-08-07' },
      { id: 2, bookingNumbers: ['178134'], bitrixIds: ['X'], title: 'Кейт 181289+178134', manager_name: 'М', load_date: '2026-08-07' },
    ]);
    expect(hard[0].dealIds.sort()).toEqual([1, 2]);
    expect(hard[0].reason).toBe('multi_booking_title');
  });

  it('soft-groups A7-like titles without writing a group', () => {
    const deals = [
      { id: 1, bookingNumbers: ['189820'], bitrixIds: ['1'], title: 'ПРО/Для оплаты А7 // Ирина // 189820/Титова', manager_name: 'Титова', load_date: '2026-09-02' },
      { id: 2, bookingNumbers: ['190321'], bitrixIds: ['2'], title: 'ПРО/ДОП.ТОЧКА/БЕРЕЖКОВСКАЯ А7 // Ирина // 190321/Титова', manager_name: 'Титова', load_date: '2026-09-01' },
    ];
    const { hard, soft } = suggestDealGroups(deals);
    expect(hard).toEqual([]);
    expect(soft[0].dealIds.sort()).toEqual([1, 2]);
    expect(soft[0].reason).toBe('soft_marker');
  });

  it('skips already grouped deals', () => {
    const { soft } = suggestDealGroups([
      { id: 1, groupId: 9, bookingNumbers: ['1'], bitrixIds: ['a'], title: 'А7', manager_name: 'Титова', load_date: '2026-09-01' },
      { id: 2, bookingNumbers: ['2'], bitrixIds: ['b'], title: 'А7', manager_name: 'Титова', load_date: '2026-09-01' },
    ]);
    expect(soft).toEqual([]);
  });

  it('flags conflict when overlapping hard clusters share a deal', () => {
    const { hard } = suggestDealGroups([
      { id: 1, bookingNumbers: ['111111', '222222'], bitrixIds: ['X'], title: 'Кейт 111111+222222', manager_name: 'М', load_date: '2026-08-07' },
      { id: 2, bookingNumbers: ['111111'], bitrixIds: ['B'], title: 'бронь 111111', manager_name: 'М', load_date: '2026-08-07' },
      { id: 3, bookingNumbers: ['222222'], bitrixIds: ['X'], title: 'Кейт 111111+222222', manager_name: 'М', load_date: '2026-08-07' },
    ]);
    expect(hard).toHaveLength(2);
    const shared = hard.find((c) => c.reason === 'shared_booking');
    const multi = hard.find((c) => c.reason === 'multi_booking_title');
    expect(shared.dealIds.sort()).toEqual([1, 2]);
    expect(multi.dealIds.sort()).toEqual([1, 3]);
    expect(shared.conflict).toBe(true);
    expect(multi.conflict).toBe(true);
    expect(shared.dealIds.filter((id) => multi.dealIds.includes(id))).toEqual([1]);
  });
});
