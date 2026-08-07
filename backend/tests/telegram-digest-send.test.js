import { describe, expect, it, vi } from 'vitest';
import { sendDigestText } from '../src/telegram/digest/send.js';

describe('sendDigestText', () => {
  it('sends with html parseMode and replyTo when thread set', async () => {
    const client = { sendMessage: vi.fn(async () => ({})) };
    await sendDigestText({
      client,
      chatId: '-1001',
      threadId: 42,
      text: '• 1\n(<a href="https://x">Twenty</a>)',
    });
    expect(client.sendMessage).toHaveBeenCalledWith('-1001', {
      message: '• 1\n(<a href="https://x">Twenty</a>)',
      parseMode: 'html',
      replyTo: 42,
    });
  });

  it('omits replyTo when thread missing', async () => {
    const client = { sendMessage: vi.fn(async () => ({})) };
    await sendDigestText({ client, chatId: '-1001', threadId: null, text: 'hi' });
    expect(client.sendMessage).toHaveBeenCalledWith('-1001', {
      message: 'hi',
      parseMode: 'html',
    });
  });
});
