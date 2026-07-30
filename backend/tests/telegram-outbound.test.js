import { describe, expect, it, vi } from 'vitest';
import { sendOkleykaToTelegram, splitCaption } from '../src/telegram/outbound.js';

describe('splitCaption', () => {
  it('keeps short text as caption', () => {
    expect(splitCaption('hello')).toEqual({ caption: 'hello', separateMessage: null });
  });
  it('splits long text', () => {
    const long = 'x'.repeat(1025);
    expect(splitCaption(long)).toEqual({ caption: null, separateMessage: long });
  });
});

describe('sendOkleykaToTelegram', () => {
  it('sends text-only when no fileUrls', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    }));
    const result = await sendOkleykaToTelegram({
      token: 't',
      chatId: '-1',
      text: 'Заказ: 1',
      fileUrls: [],
      fetchImpl,
    });
    expect(result.messageIds).toEqual([42]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('sendMessage');
  });

  it('passes message_thread_id when threadId set', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    }));
    await sendOkleykaToTelegram({
      token: 't', chatId: '-1', threadId: 9, text: 'hi', fileUrls: [], fetchImpl,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.message_thread_id).toBe(9);
  });
});
