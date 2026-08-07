import { describe, expect, it } from 'vitest';
import { applyOmniEnrichment, pickOmniCandidates } from '../src/telegram/digest/omni-merge.js';
import { RISK_LIST_LIMIT } from '../src/telegram/digest/compute.js';

const risk = (id, score, extra = {}) => ({
  opportunityId: id,
  score,
  amountRubles: extra.amountRubles ?? score * 1000,
  ready: 0,
  total: 2,
  labels: ['риск'],
  companyName: id,
  manager: '',
  bookingNo: '',
  name: id,
});

describe('pickOmniCandidates', () => {
  it('takes top 20 by existing order', () => {
    const risks = Array.from({ length: 25 }, (_, i) => risk(`r${i}`, 25 - i));
    expect(pickOmniCandidates(risks)).toHaveLength(20);
    expect(pickOmniCandidates(risks)[0].opportunityId).toBe('r0');
  });
});

describe('applyOmniEnrichment', () => {
  it('reorders and fills to 7', () => {
    const model = {
      risks: [risk('a', 5), risk('b', 4), risk('c', 3), risk('d', 2)],
    };
    const out = applyOmniEnrichment(model, {
      risks: [{ opportunityId: 'c', reason: 'why' }, { opportunityId: 'a', reason: '' }],
      notes: ['note1'],
    });
    expect(out.risks.map((r) => r.opportunityId)).toEqual(['c', 'a', 'b', 'd']);
    expect(out.risks[0].reason).toBe('why');
    expect(out.risks[1].reason).toBeUndefined();
    expect(out.notes).toEqual(['note1']);
  });

  it('falls back to model.risks when omni null or empty risk list', () => {
    const model = { risks: [risk('a', 1), risk('b', 0)] };
    expect(applyOmniEnrichment(model, null).risks).toEqual(model.risks);
    expect(applyOmniEnrichment(model, { risks: [], notes: ['x'] }).risks).toEqual(model.risks);
    expect(applyOmniEnrichment(model, { risks: [], notes: ['x'] }).notes).toEqual(['x']);
  });
});
