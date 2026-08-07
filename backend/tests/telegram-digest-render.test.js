import { describe, expect, it } from 'vitest';
import { formatCompactRub, formatRiskTitle, renderDigestMessage } from '../src/telegram/digest/render.js';
import {
  parseDealNameParts,
  bookingNoFromTonyUrl,
  bookingNoFromName,
  resolveBookingNo,
  twentyOpportunityUrl,
} from '../src/telegram/digest/label.js';

describe('formatCompactRub', () => {
  it('formats thousands and millions', () => {
    expect(formatCompactRub(420_000)).toBe('₽420к');
    expect(formatCompactRub(1_800_000)).toBe('₽1.8М');
    expect(formatCompactRub(0)).toBe('₽0');
  });
});

describe('parseDealNameParts', () => {
  it('parses tony segments', () => {
    expect(parseDealNameParts('АРЕНДА/07.08/Ольга/179037/Фест')).toEqual({
      manager: 'Ольга',
      bookingNo: '179037',
    });
  });
});

describe('bookingNoFromTonyUrl', () => {
  it('reads id= from tony orders_edit URL', () => {
    expect(
      bookingNoFromTonyUrl('https://crm.apihide.com/orders/orders_edit/?id=178323'),
    ).toBe('178323');
  });
  it('returns empty when no id', () => {
    expect(bookingNoFromTonyUrl('https://example.com/x')).toBe('');
    expect(bookingNoFromTonyUrl('')).toBe('');
  });
});

describe('bookingNoFromName', () => {
  it('takes first 5+ digit run', () => {
    expect(bookingNoFromName('ProInteractive mess 178323 extra')).toBe('178323');
    expect(bookingNoFromName('no digits')).toBe('');
  });
});

describe('resolveBookingNo', () => {
  it('prefers tony URL over name', () => {
    expect(
      resolveBookingNo({
        tonyUrl: 'https://crm.apihide.com/orders/orders_edit/?id=111111',
        name: 'x/01.01/M/999999/z',
      }),
    ).toBe('111111');
  });
  it('falls back to name when tony missing', () => {
    expect(resolveBookingNo({ tonyUrl: '', name: 'Acme 222222' })).toBe('222222');
  });
});

describe('twentyOpportunityUrl', () => {
  it('uses origin from graphql and bare host URLs', () => {
    expect(
      twentyOpportunityUrl('https://crm.example.com/graphql', 'opp-1'),
    ).toBe('https://crm.example.com/object/opportunity/opp-1');
    expect(
      twentyOpportunityUrl('https://crm.example.com/', 'opp-1'),
    ).toBe('https://crm.example.com/object/opportunity/opp-1');
  });
  it('returns empty without id or bad url', () => {
    expect(twentyOpportunityUrl('https://crm.example.com/graphql', '')).toBe('');
    expect(twentyOpportunityUrl('not-a-url', 'opp-1')).toBe('');
  });
});

describe('formatRiskTitle', () => {
  it('uses booking № only', () => {
    expect(
      formatRiskTitle({
        companyName: 'Acme',
        manager: 'Ольга',
        bookingNo: '179037',
        name: 'fallback',
      }),
    ).toBe('179037');
    expect(
      formatRiskTitle({ companyName: '', manager: '', bookingNo: '', name: 'OnlyName' }),
    ).toBe('OnlyName');
    expect(
      formatRiskTitle({ companyName: '', manager: '', bookingNo: '', name: '' }),
    ).toBe('—');
  });
});

describe('renderDigestMessage', () => {
  it('renders header and risks', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 2,
        totalPositions: 3,
        ready: { deals: 1, positions: 1, amountRubles: 100_000 },
        notReady: { deals: 1, positions: 2, amountRubles: 200_000 },
        risks: [
          {
            companyName: 'Big',
            manager: 'Mgr',
            bookingNo: '100001',
            name: 'x',
            ready: 0,
            total: 2,
            amountRubles: 400_000,
            labels: ['риск', '0 готово'],
            score: 7,
          },
        ],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08' },
    );
    expect(text).toContain('ЗАВТРА 07.08 · 2 сделок / 3 позиций');
    expect(text).toContain('✔️ 1 сделок / 1 позиций · ₽100к');
    expect(text).toContain('❌ 1 сделок / 2 позиций · ₽200к');
    expect(text).toContain('⚠ РИСКИ:');
    expect(text).toContain('• 100001 · 0/2 · ₽400к · риск · 0 готово');
  });

  it('renders нет when no risks', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 0,
        totalPositions: 0,
        ready: { deals: 0, positions: 0, amountRubles: 0 },
        notReady: { deals: 0, positions: 0, amountRubles: 0 },
        risks: [],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08' },
    );
    expect(text).toContain('⚠ РИСКИ:\nнет');
  });

  it('appends reason and notes block', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 1,
        totalPositions: 1,
        ready: { deals: 0, positions: 0, amountRubles: 0 },
        notReady: { deals: 1, positions: 1, amountRubles: 1000 },
        risks: [
          {
            bookingNo: '1',
            ready: 0,
            total: 2,
            amountRubles: 400_000,
            labels: ['риск'],
            reason: '0✓ крупный',
          },
        ],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08', notes: ['узкое место: печать'] },
    );
    expect(text).toContain('· риск · 0✓ крупный');
    expect(text).toContain('🧠\nузкое место: печать');
  });

  it('appends HTML link line and escapes plain text', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 1,
        totalPositions: 2,
        ready: { deals: 0, positions: 0, amountRubles: 0 },
        notReady: { deals: 1, positions: 2, amountRubles: 400_000 },
        risks: [
          {
            bookingNo: '178323',
            name: 'x',
            ready: 0,
            total: 2,
            amountRubles: 400_000,
            labels: ['риск'],
            reason: 'a <b> & c',
            twentyUrl: 'https://crm.example.com/object/opportunity/o1',
            tonyUrl: 'https://crm.apihide.com/orders/orders_edit/?id=178323',
            bitrixUrl: '',
          },
        ],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08' },
    );
    expect(text).toContain('• 178323 · 0/2 · ₽400к · риск · a &lt;b&gt; &amp; c');
    expect(text).toContain(
      '(<a href="https://crm.example.com/object/opportunity/o1">Twenty</a> | <a href="https://crm.apihide.com/orders/orders_edit/?id=178323">Tony</a>)',
    );
    expect(text).not.toContain('Bitrix');
  });

  it('omits link line when no URLs', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 1,
        totalPositions: 1,
        ready: { deals: 0, positions: 0, amountRubles: 0 },
        notReady: { deals: 1, positions: 1, amountRubles: 1000 },
        risks: [
          {
            bookingNo: '1',
            ready: 0,
            total: 2,
            amountRubles: 400_000,
            labels: ['риск'],
          },
        ],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08' },
    );
    expect(text).toContain('• 1 · 0/2 · ₽400к · риск');
    expect(text).not.toContain('<a href');
  });
});
