import { describe, expect, it, vi } from 'vitest';
import { NewMessage } from 'telegram/events/index.js';
import {
  handleUserbotNewMessage,
  initTeamAppMirror,
} from '../src/telegram/userbot/team-app-mirror.js';

const settings = { chatId: '-1001', topicId: 42 };

function baseDeps(overrides = {}) {
  return {
    getSettings: () => settings,
    getSelfUserId: async () => '1',
    consumeLink: vi.fn(),
    ingest: vi.fn(),
    reply: vi.fn(),
    shouldHint: vi.fn(() => true),
    ...overrides,
  };
}

function dmMessage(overrides = {}) {
  return {
    id: 10,
    peerId: { userId: 9n },
    message: 'ABC12345',
    fromId: { userId: 9n },
    replyTo: undefined,
    ...overrides,
  };
}

function topicMessage(overrides = {}) {
  return {
    id: 55,
    peerId: { channelId: 1n },
    message: 'привет',
    fromId: { userId: 9n },
    replyTo: { replyToMsgId: 42 },
    ...overrides,
  };
}

describe('handleUserbotNewMessage', () => {
  it('consumes a DM link code and replies Telegram подключён on success', async () => {
    const deps = baseDeps({
      consumeLink: vi.fn(async () => ({ ok: true, userId: 'u1' })),
    });
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: dmMessage(),
      deps,
    });
    expect(deps.consumeLink).toHaveBeenCalledWith({
      code: 'ABC12345',
      telegramUserId: '9',
    });
    expect(deps.reply).toHaveBeenCalledWith('9', 'Telegram подключён');
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it('replies expired and unknown codes the same way', async () => {
    const expired = baseDeps({
      consumeLink: vi.fn(async () => ({ ok: false, reason: 'expired' })),
    });
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: dmMessage(),
      deps: expired,
    });
    expect(expired.reply).toHaveBeenCalledWith(
      '9',
      'код не подошёл, открой Настройки ещё раз',
    );

    const unknown = baseDeps({
      consumeLink: vi.fn(async () => ({ ok: false, reason: 'unknown' })),
    });
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: dmMessage(),
      deps: unknown,
    });
    expect(unknown.reply).toHaveBeenCalledWith(
      '9',
      'код не подошёл, открой Настройки ещё раз',
    );
  });

  it('replies when the Telegram id is already taken', async () => {
    const deps = baseDeps({
      consumeLink: vi.fn(async () => ({ ok: false, reason: 'taken' })),
    });
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: dmMessage(),
      deps,
    });
    expect(deps.reply).toHaveBeenCalledWith('9', 'этот Telegram уже привязан');
  });

  it('ingests topic text with originatedByOutbox and isUserbotSelf', async () => {
    const deps = baseDeps({ ingest: vi.fn() });
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: topicMessage({
        id: 55,
        fromId: { userId: 1n },
        message: 'hi',
      }),
      deps: {
        ...deps,
        knownOutboxTelegramIds: new Set(['55']),
      },
    });
    expect(deps.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramMessageId: '55',
        telegramUserId: '1',
        kind: 'text',
        body: 'hi',
        originatedByOutbox: true,
        isUserbotSelf: true,
      }),
    );
    expect(deps.reply).not.toHaveBeenCalled();
  });

  it('downloads topic media and ingests bytes', async () => {
    const buf = Buffer.from('img');
    const downloadMedia = vi.fn(async () => buf);
    const ingest = vi.fn();
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: topicMessage({
        message: 'подпись',
        media: { className: 'MessageMediaPhoto' },
        downloadMedia,
      }),
      deps: { ...baseDeps({ ingest }), downloadMedia },
    });
    expect(downloadMedia).toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'photo',
        body: 'подпись',
        attachments: [
          expect.objectContaining({
            bytesBase64: buf.toString('base64'),
          }),
        ],
      }),
    );
  });

  it('still ingests text with файл не загрузился when media download fails', async () => {
    const ingest = vi.fn();
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: topicMessage({
        message: 'подпись',
        media: { className: 'MessageMediaDocument' },
        downloadMedia: async () => {
          throw new Error('net');
        },
      }),
      deps: baseDeps({ ingest }),
    });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        body: expect.stringMatching(/подпись.*файл не загрузился/),
      }),
    );
    expect(ingest.mock.calls[0][0].attachments).toBeUndefined();
  });

  it('hints once on unrecognized private text and does not ingest', async () => {
    const deps = baseDeps();
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: dmMessage({ message: 'hello' }),
      deps,
    });
    expect(deps.shouldHint).toHaveBeenCalledWith('9');
    expect(deps.reply).toHaveBeenCalledWith('9', 'отправь код из Настроек');
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.consumeLink).not.toHaveBeenCalled();
  });

  it('does not hint when shouldHint is false', async () => {
    const deps = baseDeps({ shouldHint: vi.fn(() => false) });
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: dmMessage({ message: 'hello' }),
      deps,
    });
    expect(deps.reply).not.toHaveBeenCalled();
  });

  it('does not copy ignored group messages into the room', async () => {
    const deps = baseDeps();
    await handleUserbotNewMessage({
      db: {},
      client: {},
      message: topicMessage({
        peerId: { channelId: 2n },
        message: 'hi',
      }),
      deps,
    });
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.reply).not.toHaveBeenCalled();
  });
});

describe('initTeamAppMirror', () => {
  it('attaches a NewMessage incoming handler once per client', () => {
    const hooks = [];
    const client = { addEventHandler: vi.fn() };
    initTeamAppMirror({ onClientReady: (fn) => hooks.push(fn) });

    expect(hooks).toHaveLength(1);
    hooks[0](client);
    hooks[0](client);
    expect(client.addEventHandler).toHaveBeenCalledTimes(1);
    const filter = client.addEventHandler.mock.calls[0][1];
    expect(filter).toBeInstanceOf(NewMessage);
  });
});
