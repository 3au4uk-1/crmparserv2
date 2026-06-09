import { describe, it, expect } from 'vitest';
import { computeLineItemDiff } from '../src/services/twenty-line-items-sync.js';

describe('computeLineItemDiff', () => {
  it('marks existing names for update and new names for create', () => {
    const existing = [
      { id: 'li-1', name: 'Баннер' },
      { id: 'li-2', name: 'Ролл-ап' },
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
  });

  it('deletes all when eligible is empty', () => {
    const existing = [{ id: 'li-1', name: 'Баннер' }];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toDelete).toEqual(['li-1']);
  });
});
