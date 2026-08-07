import { describe, expect, it } from 'vitest';
import {
  amountRubles,
  buildDigestModel,
  sliceRisksForMessage,
} from '../src/telegram/digest/compute.js';

const rub = (n) => ({ amountMicros: n * 1_000_000 });

describe('amountRubles', () => {
  it('converts micros', () => {
    expect(amountRubles(rub(150))).toBe(150);
    expect(amountRubles(null)).toBe(0);
  });
});

describe('buildDigestModel', () => {
  it('excludes OTMENA deals and items; partitions GOTOVO', () => {
    const deals = [
      { id: 'a', name: 'A', stage: 'GOTOVO', amount: rub(100), companyName: 'CoA' },
      { id: 'b', name: 'B', stage: 'V_RABOTE', amount: rub(200), companyName: 'CoB' },
      { id: 'c', name: 'C', stage: 'OTMENA', amount: rub(999), companyName: 'CoC' },
    ];
    const lineItemsByOppId = {
      a: [
        { id: '1', opportunityId: 'a', stage: 'GOTOVO' },
        { id: '2', opportunityId: 'a', stage: 'OTMENA' },
      ],
      b: [
        { id: '3', opportunityId: 'b', stage: 'NOVYY' },
        { id: '4', opportunityId: 'b', stage: 'NOVYY' },
      ],
      c: [{ id: '5', opportunityId: 'c', stage: 'NOVYY' }],
    };
    const m = buildDigestModel({ deals, lineItemsByOppId });
    expect(m.totalDeals).toBe(2);
    expect(m.totalPositions).toBe(3); // a:1 + b:2
    expect(m.ready).toEqual({ deals: 1, positions: 1, amountRubles: 100 });
    expect(m.notReady).toEqual({ deals: 1, positions: 2, amountRubles: 200 });
  });

  it('applies R0 R1 R2 and sorts by score then amount', () => {
    const deals = [
      // R0+R2+R1 candidate, large
      {
        id: 'big0',
        name: 'X/01.01/Mgr/100001/z',
        stage: 'V_RABOTE',
        amount: rub(400_000),
        companyName: 'Big',
      },
      // R1 only (50% ready, amount >= 150k)
      {
        id: 'bigHalf',
        name: 'X/01.01/Mgr/100002/z',
        stage: 'V_RABOTE',
        amount: rub(200_000),
        companyName: 'Half',
      },
      // exactly 30% — not R0; 1 ready of 1? use 3 items 1 ready = 33% not R0; 0 ready 1 item — not R2
      {
        id: 'small',
        name: 'X/01.01/Mgr/100003/z',
        stage: 'V_RABOTE',
        amount: rub(10_000),
        companyName: 'Small',
      },
      { id: 'done', name: 'D', stage: 'GOTOVO', amount: rub(500_000), companyName: 'Done' },
    ];
    const lineItemsByOppId = {
      big0: [
        { id: 'a', opportunityId: 'big0', stage: 'NOVYY' },
        { id: 'b', opportunityId: 'big0', stage: 'NOVYY' },
      ],
      bigHalf: [
        { id: 'c', opportunityId: 'bigHalf', stage: 'GOTOVO' },
        { id: 'd', opportunityId: 'bigHalf', stage: 'NOVYY' },
      ],
      small: [{ id: 'e', opportunityId: 'small', stage: 'NOVYY' }],
      done: [{ id: 'f', opportunityId: 'done', stage: 'GOTOVO' }],
    };
    const m = buildDigestModel({ deals, lineItemsByOppId });
    expect(m.risks.map((r) => r.opportunityId)).toEqual(['big0', 'bigHalf']);
    expect(m.risks[0].labels).toEqual(
      expect.arrayContaining(['риск', '0 готово', 'крупный готов не полностью']),
    );
    expect(m.risks[0].score).toBeGreaterThan(m.risks[1].score);
    expect(m.risks[1].labels).toContain('крупный готов не полностью');
    expect(m.risks[1].labels).not.toContain('риск');
  });

  it('caps risks at 7 with remainder hint via buildDigestModel option or separate slice helper', () => {
    const deals = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      name: `N/01.01/M/${100000 + i}/z`,
      stage: 'NOVYY',
      amount: rub(10_000 + i),
      companyName: `C${i}`,
    }));
    const lineItemsByOppId = Object.fromEntries(
      deals.map((d) => [
        d.id,
        [
          { id: `${d.id}a`, opportunityId: d.id, stage: 'NOVYY' },
          { id: `${d.id}b`, opportunityId: d.id, stage: 'NOVYY' },
        ],
      ]),
    );
    const m = buildDigestModel({ deals, lineItemsByOppId });
    expect(m.risks).toHaveLength(10);
    const { shown, hiddenCount } = sliceRisksForMessage(m.risks, 7);
    expect(shown).toHaveLength(7);
    expect(hiddenCount).toBe(3);
  });
});
