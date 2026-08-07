import { describe, expect, it } from 'vitest';
import { validateOmniEnrichment } from '../src/telegram/digest/omni-validate.js';

describe('validateOmniEnrichment', () => {
  const ids = new Set(['a', 'b']);

  it('keeps known ids, drops unknown, truncates reason', () => {
    const out = validateOmniEnrichment(
      {
        risks: [
          { opportunityId: 'a', reason: 'x'.repeat(100) },
          { opportunityId: 'zzz', reason: 'no' },
          { opportunityId: 'a', reason: 'dup' },
        ],
        notes: ['  one  ', '', 'n'.repeat(200), 'two', 'three', 'four', 'five'],
      },
      ids,
    );
    expect(out.risks).toEqual([{ opportunityId: 'a', reason: 'x'.repeat(80) }]);
    expect(out.notes).toHaveLength(4);
    expect(out.notes[0]).toBe('one');
    expect(out.notes[1].length).toBe(120);
  });

  it('returns null on non-object', () => {
    expect(validateOmniEnrichment(null, ids)).toBeNull();
    expect(validateOmniEnrichment('x', ids)).toBeNull();
  });
});
