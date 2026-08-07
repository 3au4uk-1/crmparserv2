import { describe, expect, it } from 'vitest';
import { formatCompactRub, formatRiskTitle, renderDigestMessage } from '../src/telegram/digest/render.js';
import { parseDealNameParts } from '../src/telegram/digest/label.js';

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

describe('formatRiskTitle', () => {
  it('joins non-empty segments', () => {
    expect(
      formatRiskTitle({
        companyName: 'Acme',
        manager: 'Ольга',
        bookingNo: '179037',
        name: 'fallback',
      }),
    ).toBe('Acme/Ольга/179037');
    expect(
      formatRiskTitle({ companyName: '', manager: '', bookingNo: '', name: 'OnlyName' }),
    ).toBe('OnlyName');
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
    expect(text).toContain('• Big/Mgr/100001 · 0/2 · ₽400к · риск · 0 готово');
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
});
