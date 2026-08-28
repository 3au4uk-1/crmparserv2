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

  it('ignoreStageProtection updates and deletes protected stages', () => {
    const existing = [
      { id: 'li-1', name: 'Баннер', stage: 'V_PECHATI' },
      { id: 'li-2', name: 'Ролл-ап', stage: 'V_RABOTE' },
    ];
    const eligible = [{ id: 10, name: 'Баннер', price: 0 }];
    const diff = computeLineItemDiff(existing, eligible, { ignoreStageProtection: true });
    expect(diff.toUpdate).toEqual([{ twentyId: 'li-1', item: eligible[0] }]);
    expect(diff.toDelete).toEqual(['li-2']);
    expect(diff.preserved).toEqual([]);
  });

  it('matches existing line items by normalized name (case-insensitive)', () => {
    const existing = [{ id: 'li-1', name: 'Велотележка для мороженого', stage: 'NOVYY' }];
    const eligible = [{ id: 1, name: 'велотележка для мороженого', price: 100 }];
    const { toUpdate, toCreate } = computeLineItemDiff(existing, eligible);
    expect(toUpdate).toHaveLength(1);
    expect(toUpdate[0].twentyId).toBe('li-1');
    expect(toCreate).toHaveLength(0);
  });

  it('matches manual_twenty parser items by twenty_id not name', () => {
    const existing = [
      { id: 'li-manual', name: 'Баннер', stage: 'NOVYY', istochnik: 'TWENTY_RUCHNAYA' },
      { id: 'li-parsed', name: 'Баннер', stage: 'NOVYY', istochnik: 'PARSER' },
    ];
    const eligible = [
      { id: 1, name: 'Другое имя', classification: 'manual_twenty', twenty_id: 'li-manual', price: 100 },
      { id: 2, name: 'Баннер', classification: 'keyword_match', twenty_id: 'li-parsed', price: 200 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate.map((x) => x.twentyId).sort()).toEqual(['li-manual', 'li-parsed']);
    expect(diff.toDelete).toEqual([]);
  });

  it('does not delete unsynced TWENTY_RUCHNAYA with non-default name', () => {
    const existing = [
      { id: 'li-draft', name: 'Баннер клиентский', stage: 'NOVYY', istochnik: 'TWENTY_RUCHNAYA' },
    ];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toDelete).toEqual([]);
  });

  it('does not delete TWENTY_RUCHNAYA draft without parser row', () => {
    const existing = [
      { id: 'li-draft', name: 'Новая позиция', stage: 'NOVYY', istochnik: 'TWENTY_RUCHNAYA' },
    ];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toDelete).toEqual([]);
  });

  it('deletes TWENTY_RUCHNAYA when twenty_id exists in parser manuals set (archived)', () => {
    const existing = [
      { id: 'li-gone', name: 'Баннер', stage: 'NOVYY', istochnik: 'TWENTY_RUCHNAYA' },
    ];
    const diff = computeLineItemDiff(existing, [], {
      manualParserTwentyIds: new Set(['li-gone']),
    });
    expect(diff.toDelete).toEqual(['li-gone']);
  });

  it('updates by twenty_id even when names differ', () => {
    const existing = [
      { id: 'li-a', name: 'Старое', stage: 'NOVYY' },
      { id: 'li-b', name: 'Другое', stage: 'NOVYY' },
    ];
    const eligible = [
      { id: 1, name: 'НовоеА', twenty_id: 'li-a', price: 1 },
      { id: 2, name: 'НовоеБ', twenty_id: 'li-b', price: 2 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([
      { twentyId: 'li-a', item: eligible[0] },
      { twentyId: 'li-b', item: eligible[1] },
    ]);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toDelete).toEqual([]);
  });

  it('FIFO-matches duplicate names without twenty_id', () => {
    const existing = [
      { id: 'li-1', name: 'Макет', stage: 'NOVYY' },
      { id: 'li-2', name: 'Макет', stage: 'NOVYY' },
    ];
    const eligible = [
      { id: 1, name: 'Макет', price: 10 },
      { id: 2, name: 'Макет', price: 20 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([
      { twentyId: 'li-1', item: eligible[0] },
      { twentyId: 'li-2', item: eligible[1] },
    ]);
    expect(diff.toCreate).toEqual([]);
  });

  it('does not send two updates to the same existing id for duplicate names', () => {
    const existing = [{ id: 'li-only', name: 'Макет', stage: 'NOVYY' }];
    const eligible = [
      { id: 1, name: 'Макет', price: 10 },
      { id: 2, name: 'Макет', price: 20 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([{ twentyId: 'li-only', item: eligible[0] }]);
    expect(diff.toCreate).toEqual([eligible[1]]);
  });

  it('preserves unclaimed existing items when scoped is true', () => {
    const existing = [
      { id: 'li-brand', name: 'Баннер', stage: 'NOVYY' },
      { id: 'li-decor', name: 'Гирлянда', stage: 'NOVYY' },
    ];
    const eligible = [{ id: 20, name: 'Гирлянда', price: 50, productStream: 'DECOR' }];

    const unscoped = computeLineItemDiff(existing, eligible, { ignoreStageProtection: true });
    expect(unscoped.toDelete).toEqual(['li-brand']);

    const scoped = computeLineItemDiff(existing, eligible, {
      ignoreStageProtection: true,
      scoped: true,
    });
    expect(scoped.toDelete).toEqual([]);
    expect(scoped.toUpdate).toEqual([{ twentyId: 'li-decor', item: eligible[0] }]);
    expect(scoped.toCreate).toEqual([]);
    expect(scoped.preserved).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'li-brand', name: 'Баннер' })]),
    );
  });
});
