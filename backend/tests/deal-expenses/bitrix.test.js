import { describe, it, expect } from 'vitest';
import { extractDealId, normalizeUrl } from '../../src/services/deal-expenses/bitrix.js';

describe('extractDealId', () => {
  it('extracts deal id from Bitrix CRM URL', () => {
    const url = 'https://apihide.com/bitrix/crm/deal/details/169120/';
    expect(extractDealId(url)).toBe('169120');
  });

  it('extracts deal id from URL embedded in text', () => {
    const text = 'Сделка https://example.com/crm/deal/details/42/?IFRAME=Y';
    expect(extractDealId(text)).toBe('42');
  });

  it('returns null when no deal id is present', () => {
    expect(extractDealId('not a deal link')).toBeNull();
    expect(extractDealId('')).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('strips query string and trailing slash', () => {
    const url = 'https://example.com/crm/deal/details/99/?foo=bar';
    expect(normalizeUrl(url)).toBe('https://example.com/crm/deal/details/99');
  });
});
