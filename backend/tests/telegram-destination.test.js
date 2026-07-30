import { describe, expect, it } from 'vitest';
import { normalizeOkleykaDestination } from '../src/telegram/settings.js';

describe('normalizeOkleykaDestination', () => {
  it('parses legacy string chat id', () => {
    expect(normalizeOkleykaDestination('-1001')).toEqual({ chatId: '-1001', threadId: null });
  });
  it('parses object with threadId', () => {
    expect(normalizeOkleykaDestination({ chatId: '-1001', threadId: 42 })).toEqual({
      chatId: '-1001',
      threadId: 42,
    });
  });
  it('returns null for empty', () => {
    expect(normalizeOkleykaDestination('')).toBeNull();
    expect(normalizeOkleykaDestination(null)).toBeNull();
    expect(normalizeOkleykaDestination({ chatId: '' })).toBeNull();
  });
  it('coerces numeric threadId strings', () => {
    expect(normalizeOkleykaDestination({ chatId: '-1', threadId: '7' })).toEqual({
      chatId: '-1',
      threadId: 7,
    });
  });
});
