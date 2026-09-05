import { describe, expect, it } from 'vitest';
import { chatIdCandidates, normalizeTelegramChatId } from '../src/telegram/chat-id.js';

describe('normalizeTelegramChatId', () => {
  it('keeps a Bot API supergroup id', () => {
    expect(normalizeTelegramChatId('-100555000555')).toBe('-100555000555');
  });

  it('adds -100 to a t.me/c/ internal id', () => {
    expect(normalizeTelegramChatId('https://t.me/c/555000555/4')).toBe('-100555000555');
  });

  it('adds -100 to a bare internal forum id', () => {
    expect(normalizeTelegramChatId('555000555')).toBe('-100555000555');
  });

  it('prefixes a 100… id that is missing the minus', () => {
    expect(normalizeTelegramChatId('100555000555')).toBe('-100555000555');
  });
});

describe('chatIdCandidates', () => {
  it('tries the typed value and the normalized Bot API id', () => {
    expect(chatIdCandidates('555000555')).toEqual(['555000555', '-100555000555']);
  });
});
