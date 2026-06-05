import { describe, it, expect } from 'vitest';
import { buildNoteCreateInput, formatItemsAsNoteMarkdown } from '../src/services/twenty-note.js';

describe('twenty-note', () => {
  it('uses bodyV2 with markdown for Twenty API', () => {
    const input = buildNoteCreateInput('Title', 'line1\nline2', 'opp-123');
    expect(input.bodyV2).toEqual({ markdown: 'line1\nline2', blocknote: null });
    expect(input.body).toBeUndefined();
    expect(input.activityTargets).toEqual([{ opportunityId: 'opp-123' }]);
  });

  it('formats items as markdown list', () => {
    const md = formatItemsAsNoteMarkdown([
      { name: 'Баннер', price: 1000, quantity: '2 шт.' },
    ]);
    expect(md).toContain('- Баннер');
    expect(md).toMatch(/1[\s\u00a0]000/);
  });
});
