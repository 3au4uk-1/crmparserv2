import { describe, it, expect } from 'vitest';
import { resolvePrintSheetDepartment } from '../src/services/print-sheet-departments.js';

describe('resolvePrintSheetDepartment', () => {
  const map = {
    '8814cccb-471e-4d05-90cb-261a9395ada8': 'Про',
    'df0952a9-c780-4cd1-bd85-ba6f0bf76512': 'АРТ',
  };

  it('returns mapped department label', () => {
    expect(resolvePrintSheetDepartment('8814cccb-471e-4d05-90cb-261a9395ada8', map)).toBe('Про');
  });

  it('returns empty string for unmapped company (e.g. Биржа Лидов)', () => {
    expect(resolvePrintSheetDepartment('d9a124be-d8ef-4dd6-b769-f6dc1dd34673', map)).toBe('');
  });

  it('returns empty string for null companyId', () => {
    expect(resolvePrintSheetDepartment(null, map)).toBe('');
  });
});
