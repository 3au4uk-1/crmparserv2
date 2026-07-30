import { describe, expect, it } from 'vitest';
import { mergeChatMapEntry } from '../src/telegram/settings.js';

describe('mergeChatMapEntry', () => {
  it('stores object destination for okleyka.send', () => {
    expect(mergeChatMapEntry({}, { 'okleyka.send': { chatId: '-1', threadId: 1 } })).toEqual({
      'okleyka.send': { chatId: '-1', threadId: 1 },
    });
  });
  it('normalizes legacy string', () => {
    expect(mergeChatMapEntry({}, { 'okleyka.send': '-100' })).toEqual({
      'okleyka.send': { chatId: '-100' },
    });
  });
  it('clears okleyka.send when patch is empty or null', () => {
    const existing = { 'okleyka.send': { chatId: '-100', threadId: 1 } };
    expect(mergeChatMapEntry(existing, { 'okleyka.send': '' })).toEqual({
      'okleyka.send': '',
    });
    expect(mergeChatMapEntry(existing, { 'okleyka.send': null })).toEqual({
      'okleyka.send': '',
    });
  });
});
