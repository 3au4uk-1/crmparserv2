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

describe('sendOkleykaToTelegram (userbot)', () => {
  it('sends text-only via sendMessage when no fileUrls', async () => {
    const client = {
      sendMessage: vi.fn(async () => ({ id: 42 })),
      sendFile: vi.fn(),
    };
    const result = await sendOkleykaToTelegram({
      client,
      chatId: '-1',
      text: 'Заказ: 1',
      fileUrls: [],
    });
    expect(result.messageIds).toEqual([42]);
    expect(client.sendMessage).toHaveBeenCalledWith('-1', { message: 'Заказ: 1' });
    expect(client.sendFile).not.toHaveBeenCalled();
  });

  it('passes replyTo when threadId set', async () => {
    const client = {
      sendMessage: vi.fn(async () => ({ id: 1 })),
      sendFile: vi.fn(),
    };
    await sendOkleykaToTelegram({
      client,
      chatId: '-1',
      threadId: 9,
      text: 'hi',
      fileUrls: [],
    });
    expect(client.sendMessage).toHaveBeenCalledWith('-1', {
      message: 'hi',
      replyTo: 9,
    });
  });

  it('sends album via sendFile and downloads files', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    const client = {
      sendMessage: vi.fn(),
      sendFile: vi.fn(async () => [{ id: 10 }, { id: 11 }]),
    };
    const result = await sendOkleykaToTelegram({
      client,
      chatId: '-100',
      threadId: 5,
      text: 'cap',
      fileUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.sendFile).toHaveBeenCalledWith(
      '-100',
      expect.objectContaining({
        caption: 'cap',
        replyTo: 5,
      }),
    );
    expect(result.messageIds).toEqual([10, 11]);
  });
});
