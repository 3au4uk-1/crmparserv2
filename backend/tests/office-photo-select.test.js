import { describe, expect, it } from 'vitest';
import {
  isOfficePhotoTip,
  needsOfficePhotoTask,
  shouldSkipCancelled,
} from '../src/services/office-photo-tasks/select.js';

describe('isOfficePhotoTip', () => {
  it('accepts banner and podryad tips', () => {
    expect(isOfficePhotoTip('BANNERA')).toBe(true);
    expect(isOfficePhotoTip('PODRYAD')).toBe(true);
  });

  it('rejects other tips', () => {
    expect(isOfficePhotoTip('PLENKA')).toBe(false);
  });
});

describe('shouldSkipCancelled', () => {
  it('skips when opportunity is cancelled', () => {
    expect(
      shouldSkipCancelled({ opportunityStage: 'OTMENA', lineItemStage: 'NOVYY' }),
    ).toBe(true);
  });

  it('skips when line item is cancelled', () => {
    expect(
      shouldSkipCancelled({ opportunityStage: 'NOVYY', lineItemStage: 'OTMENA' }),
    ).toBe(true);
  });

  it('does not skip active stages', () => {
    expect(
      shouldSkipCancelled({ opportunityStage: 'NOVYY', lineItemStage: 'NOVYY' }),
    ).toBe(false);
  });
});

describe('needsOfficePhotoTask', () => {
  const tomorrowCase = {
    tip: 'BANNERA',
    loadDateYmd: '2026-08-28',
    tomorrowYmd: '2026-08-28',
    todayYmd: '2026-08-27',
    hasOpenTask: false,
  };

  it('creates task for tomorrow loadDate when no open task exists', () => {
    expect(needsOfficePhotoTask(tomorrowCase)).toBe(true);
  });

  it('skips when an open task already exists', () => {
    expect(needsOfficePhotoTask({ ...tomorrowCase, hasOpenTask: true })).toBe(false);
  });

  it('creates catch-up task for today loadDate', () => {
    expect(
      needsOfficePhotoTask({
        tip: 'BANNERA',
        loadDateYmd: '2026-08-27',
        tomorrowYmd: '2026-08-28',
        todayYmd: '2026-08-27',
        hasOpenTask: false,
      }),
    ).toBe(true);
  });

  it('skips non-office tips', () => {
    expect(
      needsOfficePhotoTask({
        ...tomorrowCase,
        tip: 'PLENKA',
      }),
    ).toBe(false);
  });

  it('skips load dates outside today or tomorrow window', () => {
    expect(
      needsOfficePhotoTask({
        ...tomorrowCase,
        loadDateYmd: '2026-08-29',
      }),
    ).toBe(false);
  });
});
