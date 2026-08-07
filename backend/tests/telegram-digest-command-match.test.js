import { describe, expect, it } from 'vitest';
import { messageMatchesDigestDest } from '../src/telegram/digest/command-match.js';

describe('messageMatchesDigestDest', () => {
  it('matches chat and topic', () => {
    expect(
      messageMatchesDigestDest({
        sourceChatId: '-1001',
        messageThreadId: 42,
        dest: { chatId: '-1001', threadId: 42 },
      }),
    ).toBe(true);
  });

  it('rejects wrong chat', () => {
    expect(
      messageMatchesDigestDest({
        sourceChatId: '-1002',
        messageThreadId: 42,
        dest: { chatId: '-1001', threadId: 42 },
      }),
    ).toBe(false);
  });

  it('rejects wrong topic', () => {
    expect(
      messageMatchesDigestDest({
        sourceChatId: '-1001',
        messageThreadId: 99,
        dest: { chatId: '-1001', threadId: 42 },
      }),
    ).toBe(false);
  });

  it('accepts any topic when dest has no threadId', () => {
    expect(
      messageMatchesDigestDest({
        sourceChatId: '-1001',
        messageThreadId: 99,
        dest: { chatId: '-1001' },
      }),
    ).toBe(true);
    expect(
      messageMatchesDigestDest({
        sourceChatId: '-1001',
        messageThreadId: null,
        dest: { chatId: '-1001' },
      }),
    ).toBe(true);
  });

  it('returns false when dest or sourceChatId missing', () => {
    expect(messageMatchesDigestDest({ sourceChatId: '-1001', dest: {} })).toBe(false);
    expect(
      messageMatchesDigestDest({
        messageThreadId: 1,
        dest: { chatId: '-1001', threadId: 1 },
      }),
    ).toBe(false);
  });
});
