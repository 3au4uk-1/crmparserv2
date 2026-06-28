import { describe, it, expect } from 'vitest';
import {
  computeLineItemDiff,
  isProtectedLineItemStage,
} from '../src/services/twenty-line-items-sync.js';

describe('isProtectedLineItemStage', () => {
  it('treats null and NOVYY as deletable', () => {
    expect(isProtectedLineItemStage(null)).toBe(false);
    expect(isProtectedLineItemStage(undefined)).toBe(false);
    expect(isProtectedLineItemStage('NOVYY')).toBe(false);
  });

  it('protects production stages', () => {
    expect(isProtectedLineItemStage('V_RABOTE')).toBe(true);
    expect(isProtectedLineItemStage('V_PECHATI')).toBe(true);
    expect(isProtectedLineItemStage('GOTOVO')).toBe(true);
    expect(isProtectedLineItemStage('OTMENA')).toBe(true);
  });
});

describe('computeLineItemDiff', () => {
  it('marks existing names for update and new names for create', () => {
    const existing = [
      { id: 'li-1', name: 'Баннер', stage: null },
      { id: 'li-2', name: 'Ролл-ап', stage: 'NOVYY' },
    ];
    const eligible = [
      { id: 10, name: 'Баннер', price: 100 },
      { id: 11, name: 'Наклейки', price: 50 },
    ];

    const diff = computeLineItemDiff(existing, eligible);

    expect(diff.toUpdate).toEqual([
      { twentyId: 'li-1', item: eligible[0] },
    ]);
    expect(diff.toCreate).toEqual([eligible[1]]);
    expect(diff.toDelete).toEqual(['li-2']);
    expect(diff.preserved).toEqual([]);
  });

  it('deletes deletable stages when eligible is empty', () => {
    const existing = [
      { id: 'li-1', name: 'Баннер', stage: null },
      { id: 'li-2', name: 'Ролл-ап', stage: 'NOVYY' },
    ];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toDelete).toEqual(['li-1', 'li-2']);
    expect(diff.preserved).toEqual([]);
  });

  it('preserves missing items with non-NOVYY stage', () => {
    const existing = [
      { id: 'li-1', name: 'Баннер', stage: 'V_PECHATI' },
      { id: 'li-2', name: 'Ролл-ап', stage: 'NOVYY' },
    ];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toDelete).toEqual(['li-2']);
    expect(diff.preserved).toEqual([
      { id: 'li-1', name: 'Баннер', stage: 'V_PECHATI' },
    ]);
  });

  it('skips update when existing line item has protected stage', () => {
    const existing = [{ id: 'li-1', name: 'Баннер', stage: 'V_RABOTE' }];
    const eligible = [{ id: 10, name: 'Баннер', price: 200 }];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toDelete).toEqual([]);
    expect(diff.preserved).toEqual([]);
  });

  it('updates when existing line item is NOVYY', () => {
    const existing = [{ id: 'li-1', name: 'Баннер', stage: 'NOVYY' }];
    const eligible = [{ id: 10, name: 'Баннер', price: 200 }];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([{ twentyId: 'li-1', item: eligible[0] }]);
  });

  it('with empty eligible deletes only deletable stages', () => {
    const existing = [
      { id: 'li-1', name: 'A', stage: null },
      { id: 'li-2', name: 'B', stage: 'V_PECHATI' },
      { id: 'li-3', name: 'C', stage: 'NOVYY' },
    ];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toDelete).toEqual(['li-1', 'li-3']);
    expect(diff.preserved).toEqual([{ id: 'li-2', name: 'B', stage: 'V_PECHATI' }]);
  });
});
