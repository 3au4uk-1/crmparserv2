import { describe, it, expect } from 'vitest';
import { parseSpreadsheetId } from '../../src/services/deal-expenses/spreadsheet-id.js';

describe('parseSpreadsheetId', () => {
  it('extracts ID from Google Sheets URL', () => {
    const url =
      'https://docs.google.com/spreadsheets/d/1abcDEF_123-xyz/edit#gid=0';
    expect(parseSpreadsheetId(url)).toBe('1abcDEF_123-xyz');
  });

  it('returns bare ID when input is already an ID', () => {
    const id = 'abcdefghijklmnopqrstuvwxyz12';
    expect(parseSpreadsheetId(id)).toBe(id);
  });

  it('returns empty string for invalid input', () => {
    expect(parseSpreadsheetId('')).toBe('');
    expect(parseSpreadsheetId('short')).toBe('');
    expect(parseSpreadsheetId(null)).toBe('');
  });
});
