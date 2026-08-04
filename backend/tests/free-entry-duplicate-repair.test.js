import { describe, it, expect } from 'vitest';
import {
  isFreeEntryTemplateName,
  planTwentyFreeEntryRename,
  planTwentyNameDisambiguation,
  planLocalTwentyIdUntangle,
  dealNeedsFreeEntryRepair,
} from '../src/services/free-entry-duplicate-repair.js';

const FREE_ENTRY_TEMPLATE =
  'БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )';

describe('free-entry-duplicate-repair', () => {
  describe('isFreeEntryTemplateName', () => {
    it('detects free-entry template case-insensitively', () => {
      expect(isFreeEntryTemplateName(FREE_ENTRY_TEMPLATE)).toBe(true);
      expect(isFreeEntryTemplateName('брендинг СВОБОДНАЯ запись')).toBe(true);
      expect(isFreeEntryTemplateName('Баннер 2x3')).toBe(false);
    });
  });

  describe('planTwentyFreeEntryRename', () => {
    it('plans rename from first comment line for template rows', () => {
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: FREE_ENTRY_TEMPLATE,
          kommentariy: 'Логотип на стол',
        }),
      ).toEqual({
        id: 'li-1',
        name: 'Логотип на стол',
        kommentariy: '',
      });
    });

    it('uses first line only for multiline comments', () => {
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: FREE_ENTRY_TEMPLATE,
          kommentariy: 'Первая строка\nвторая',
        }),
      ).toEqual({
        id: 'li-1',
        name: 'Первая строка',
        kommentariy: '',
      });
    });

    it('returns null when name is not a template or comment is empty', () => {
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: 'Логотип на стол',
          kommentariy: 'другой текст',
        }),
      ).toBeNull();
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: FREE_ENTRY_TEMPLATE,
          kommentariy: '  ',
        }),
      ).toBeNull();
    });
  });

  describe('planTwentyNameDisambiguation', () => {
    it('suffixes duplicate names by createdAt then id', () => {
      const plan = planTwentyNameDisambiguation([
        { id: 'b', name: 'Макет', createdAt: '2026-01-02' },
        { id: 'a', name: 'Макет', createdAt: '2026-01-01' },
        { id: 'c', name: 'Баннер', createdAt: '2026-01-01' },
      ]);
      expect(plan).toEqual([{ id: 'b', name: 'Макет (#2)' }]);
    });

    it('is idempotent when names already have (#N) suffixes', () => {
      const items = [
        { id: 'a', name: 'Макет', createdAt: '2026-01-01' },
        { id: 'b', name: 'Макет (#2)', createdAt: '2026-01-02' },
      ];
      expect(planTwentyNameDisambiguation(items)).toEqual([]);
      expect(planTwentyNameDisambiguation(items)).toEqual([]);
    });

    it('skips items that already match their expected disambig suffix', () => {
      const plan = planTwentyNameDisambiguation([
        { id: 'a', name: 'Макет', createdAt: '2026-01-01' },
        { id: 'b', name: 'Макет (#2)', createdAt: '2026-01-02' },
        { id: 'c', name: 'Макет', createdAt: '2026-01-03' },
      ]);
      expect(plan).toEqual([{ id: 'c', name: 'Макет (#3)' }]);
    });
  });

  describe('planLocalTwentyIdUntangle', () => {
    it('untangles shared twenty_id preferring amount_locked', () => {
      const local = [
        { id: 1, name: 'Макет', twenty_id: 'li-shared', amount_locked: 0 },
        { id: 2, name: 'Макет (#2)', twenty_id: 'li-shared', amount_locked: 1 },
      ];
      const twenty = [
        { id: 'li-shared', name: 'Макет' },
        { id: 'li-orphan', name: 'Макет (#2)' },
      ];
      const plan = planLocalTwentyIdUntangle(local, twenty);
      expect(plan).toEqual(
        expect.arrayContaining([
          { localId: 2, twenty_id: 'li-shared' },
          { localId: 1, twenty_id: 'li-orphan' },
        ]),
      );
    });

    it('clears twenty_id when no orphan match is available', () => {
      const local = [
        { id: 1, name: 'Макет', twenty_id: 'li-shared', amount_locked: 0 },
        { id: 2, name: 'Макет (#2)', twenty_id: 'li-shared', amount_locked: 1 },
      ];
      const twenty = [{ id: 'li-shared', name: 'Макет' }];
      const plan = planLocalTwentyIdUntangle(local, twenty);
      expect(plan).toEqual(
        expect.arrayContaining([{ localId: 1, twenty_id: null }]),
      );
    });
  });

  describe('dealNeedsFreeEntryRepair', () => {
    it('returns true for template names, shared twenty_id, or duplicate normalized names', () => {
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [{ id: 1, name: FREE_ENTRY_TEMPLATE, twenty_id: 'li-1' }],
          twentyItems: [{ id: 'li-1', name: FREE_ENTRY_TEMPLATE }],
        }),
      ).toBe(true);
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [
            { id: 1, name: 'A', twenty_id: 'li-shared' },
            { id: 2, name: 'B', twenty_id: 'li-shared' },
          ],
          twentyItems: [
            { id: 'li-shared', name: 'A' },
            { id: 'li-other', name: 'B' },
          ],
        }),
      ).toBe(true);
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [],
          twentyItems: [
            { id: 'li-1', name: 'Макет' },
            { id: 'li-2', name: 'Макет' },
          ],
        }),
      ).toBe(true);
    });

    it('returns false when deal has no repair triggers', () => {
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [
            { id: 1, name: 'Макет', twenty_id: 'li-1' },
            { id: 2, name: 'Баннер', twenty_id: 'li-2' },
          ],
          twentyItems: [
            { id: 'li-1', name: 'Макет' },
            { id: 'li-2', name: 'Баннер' },
          ],
        }),
      ).toBe(false);
    });
  });
});
