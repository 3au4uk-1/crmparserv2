import { describe, it, expect } from 'vitest';
import { parseRowNumberFromUpdatedRange } from '../src/services/print-sheet-append.js';

describe('parseRowNumberFromUpdatedRange', () => {
  it('parses row from Sheets updatedRange', () => {
    expect(parseRowNumberFromUpdatedRange("'Июнь 2026'!B297:K297")).toBe(297);
  });

  it('returns null when range missing', () => {
    expect(parseRowNumberFromUpdatedRange(undefined)).toBeNull();
  });
});
