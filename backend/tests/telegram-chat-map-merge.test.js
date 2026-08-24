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

  it('stores object destination for digest.morning', () => {
    expect(
      mergeChatMapEntry({}, { 'digest.morning': { chatId: '-200', threadId: 3 } }),
    ).toEqual({
      'digest.morning': { chatId: '-200', threadId: 3 },
    });
  });

  it('normalizes legacy string for digest.morning', () => {
    expect(mergeChatMapEntry({}, { 'digest.morning': '-200' })).toEqual({
      'digest.morning': { chatId: '-200' },
    });
  });

  it('preserves okleyka.send when patching digest.morning', () => {
    const existing = { 'okleyka.send': { chatId: '-100', threadId: 1 } };
    expect(
      mergeChatMapEntry(existing, { 'digest.morning': { chatId: '-200', threadId: 9 } }),
    ).toEqual({
      'okleyka.send': { chatId: '-100', threadId: 1 },
      'digest.morning': { chatId: '-200', threadId: 9 },
    });
  });

  it('clears digest.morning when patch is empty or null', () => {
    const existing = { 'digest.morning': { chatId: '-200', threadId: 3 } };
    expect(mergeChatMapEntry(existing, { 'digest.morning': '' })).toEqual({
      'digest.morning': '',
    });
    expect(mergeChatMapEntry(existing, { 'digest.morning': null })).toEqual({
      'digest.morning': '',
    });
  });

  it('stores object destination for banner_podryad.evening', () => {
    expect(
      mergeChatMapEntry({}, { 'banner_podryad.evening': { chatId: '-300', threadId: 7 } }),
    ).toEqual({
      'banner_podryad.evening': { chatId: '-300', threadId: 7 },
    });
  });

  it('normalizes legacy string for banner_podryad.evening', () => {
    expect(mergeChatMapEntry({}, { 'banner_podryad.evening': '-300' })).toEqual({
      'banner_podryad.evening': { chatId: '-300' },
    });
  });

  it('preserves okleyka.send and digest.morning when patching banner_podryad.evening', () => {
    const existing = {
      'okleyka.send': { chatId: '-100', threadId: 1 },
      'digest.morning': { chatId: '-200', threadId: 9 },
    };
    expect(
      mergeChatMapEntry(existing, {
        'banner_podryad.evening': { chatId: '-300', threadId: 7 },
      }),
    ).toEqual({
      'okleyka.send': { chatId: '-100', threadId: 1 },
      'digest.morning': { chatId: '-200', threadId: 9 },
      'banner_podryad.evening': { chatId: '-300', threadId: 7 },
    });
  });

  it('clears banner_podryad.evening when patch is empty or null', () => {
    const existing = { 'banner_podryad.evening': { chatId: '-300', threadId: 7 } };
    expect(mergeChatMapEntry(existing, { 'banner_podryad.evening': '' })).toEqual({
      'banner_podryad.evening': '',
    });
    expect(mergeChatMapEntry(existing, { 'banner_podryad.evening': null })).toEqual({
      'banner_podryad.evening': '',
    });
  });
});
