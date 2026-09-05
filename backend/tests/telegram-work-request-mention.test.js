import { describe, expect, it, vi } from 'vitest';
import { collectAlbumMessage } from '../src/telegram/work-requests/album.js';
import { messageMentionsBot } from '../src/telegram/work-requests/mention.js';

describe('messageMentionsBot', () => {
  it('detects the configured username from a Telegram mention entity', () => {
    const message = {
      text: '@intake_bot\nЧто посчитать: вывеску',
      entities: [{ type: 'mention', offset: 0, length: 11 }],
    };

    expect(messageMentionsBot(message, 'intake_bot')).toBe(true);
    expect(messageMentionsBot(message, '@INTAKE_BOT')).toBe(true);
    expect(messageMentionsBot(message, 'other_bot')).toBe(false);
  });

  it('uses caption entities and ignores plain text without a mention entity', () => {
    const captioned = {
      caption: 'Файл для @intake_bot',
      caption_entities: [{ type: 'mention', offset: 10, length: 11 }],
    };

    expect(messageMentionsBot(captioned, 'intake_bot')).toBe(true);
    expect(messageMentionsBot({ text: '@intake_bot' }, 'intake_bot')).toBe(false);
  });
});

describe('collectAlbumMessage', () => {
  it('returns a message without a media group immediately', async () => {
    const message = { message_id: 1, chat: { id: -1001 } };
    await expect(collectAlbumMessage(new Map(), message)).resolves.toEqual([message]);
  });

  it('collects messages from the same chat and media group', async () => {
    const state = new Map();
    let release;
    const schedule = vi.fn((callback) => {
      release = callback;
    });
    const first = { message_id: 1, media_group_id: 'album-1', chat: { id: -1001 } };
    const second = { message_id: 2, media_group_id: 'album-1', chat: { id: -1001 } };

    const firstResult = collectAlbumMessage(state, first, { schedule });
    const secondResult = collectAlbumMessage(state, second, { schedule });
    release();

    await expect(firstResult).resolves.toEqual([first, second]);
    await expect(secondResult).resolves.toEqual([first, second]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(state.size).toBe(0);
  });
});
