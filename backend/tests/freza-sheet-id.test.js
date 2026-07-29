import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({
    prepare: () => ({ get: getMock }),
  }),
}));

vi.mock('../src/config.js', () => ({
  config: { frezaSheetId: '' },
}));

import { resolveFrezaSheetId } from '../src/services/freza-sheet-id.js';

describe('resolveFrezaSheetId', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('returns empty when setting and env are empty', () => {
    getMock.mockReturnValue({ value: '' });
    expect(resolveFrezaSheetId()).toBe('');
  });

  it('parses spreadsheet id from settings URL', () => {
    getMock.mockReturnValue({
      value:
        'https://docs.google.com/spreadsheets/d/13w2SYQEgY2BUFKDdR3-vPCZGyeAZgBYlTFpm-EO8waw/edit',
    });
    expect(resolveFrezaSheetId()).toBe('13w2SYQEgY2BUFKDdR3-vPCZGyeAZgBYlTFpm-EO8waw');
  });
});
