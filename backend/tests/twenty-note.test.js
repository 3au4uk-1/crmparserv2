import { describe, it, expect } from 'vitest';
import {
  buildNoteCreateInput,
  buildNoteTargetCreateInput,
  formatItemsAsNoteMarkdown,
} from '../src/services/twenty-note.js';

describe('twenty-note', () => {
  it('uses bodyV2 without activityTargets', () => {
    const input = buildNoteCreateInput('Title', 'line1\nline2');
    expect(input.bodyV2).toEqual({ markdown: 'line1\nline2', blocknote: null });
    expect(input.activityTargets).toBeUndefined();
  });

  it('links note to opportunity via NoteTarget', () => {
    const input = buildNoteTargetCreateInput('note-123', 'opp-456');
    expect(input).toEqual({
      noteId: 'note-123',
      targetOpportunityId: 'opp-456',
    });
  });

  it('formats items as markdown list', () => {
    const md = formatItemsAsNoteMarkdown([
      { name: 'Баннер', price: 1000, quantity: '2 шт.' },
    ]);
    expect(md).toContain('- Баннер');
    expect(md).toMatch(/1[\s\u00a0]000/);
  });
});
