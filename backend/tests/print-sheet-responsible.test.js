import { describe, it, expect } from 'vitest';
import {
  formatPersonName,
  formatResponsibleFromUpdatedBy,
  buildWorkspaceMemberMap,
} from '../src/services/print-sheet-responsible.js';

describe('formatPersonName', () => {
  it('formats full name object', () => {
    expect(formatPersonName({ firstName: 'Андрей', lastName: 'Абашин' })).toBe('Андрей Абашин');
  });

  it('returns string name as-is', () => {
    expect(formatPersonName('crmscraper')).toBe('crmscraper');
  });
});

describe('formatResponsibleFromUpdatedBy', () => {
  const members = buildWorkspaceMemberMap([
    { id: 'wm-1', name: { firstName: 'Илья', lastName: 'Очаев' } },
  ]);

  it('prefers workspace member name when workspaceMemberId is set', () => {
    expect(
      formatResponsibleFromUpdatedBy(
        { workspaceMemberId: 'wm-1', name: 'legacy-string' },
        members
      )
    ).toBe('Илья Очаев');
  });

  it('uses string updatedBy.name when no member id', () => {
    expect(formatResponsibleFromUpdatedBy({ name: 'crmscraper' }, members)).toBe('crmscraper');
  });

  it('uses object updatedBy.name when no member id', () => {
    expect(
      formatResponsibleFromUpdatedBy(
        { name: { firstName: 'Андрей', lastName: 'Абалин' } },
        members
      )
    ).toBe('Андрей Абалин');
  });
});
