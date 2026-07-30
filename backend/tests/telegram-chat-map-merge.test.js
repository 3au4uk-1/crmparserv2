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
});
