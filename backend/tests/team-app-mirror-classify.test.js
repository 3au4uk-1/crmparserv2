import { describe, expect, it } from 'vitest';
import { classifyUserbotMessage } from '../src/telegram/userbot/team-app-mirror.js';

const settings = { chatId: '-1001', topicId: 42 };

describe('classifyUserbotMessage', () => {
  it('treats private numeric/alnum 8-char as link_code', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: null,
        threadId: null,
        senderId: '9',
        selfId: '1',
        text: 'ABC12345',
        settings,
        knownOutboxTelegramIds: new Set(),
      }),
    ).toEqual({ action: 'link_code', code: 'ABC12345' });
  });

  it('ignores private messages that are not 8-char codes', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: null,
        threadId: null,
        senderId: '9',
        selfId: '1',
        text: 'hello',
        settings,
        knownOutboxTelegramIds: new Set(),
      }).action,
    ).toBe('ignore');
  });

  it('ignores other groups', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: '-1002',
        threadId: 42,
        senderId: '9',
        selfId: '1',
        text: 'hi',
        settings,
        knownOutboxTelegramIds: new Set(),
      }).action,
    ).toBe('ignore');
  });

  it('ignores other topics in the configured chat', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: '-1001',
        threadId: 99,
        senderId: '9',
        selfId: '1',
        text: 'hi',
        settings,
        knownOutboxTelegramIds: new Set(),
      }).action,
    ).toBe('ignore');
  });

  it('flags outbox echo', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: '-1001',
        threadId: 42,
        senderId: '1',
        selfId: '1',
        text: 'hi',
        settings,
        knownOutboxTelegramIds: new Set(['55']),
        telegramMessageId: '55',
      }),
    ).toMatchObject({
      action: 'topic_inbound',
      originatedByOutbox: true,
      isUserbotSelf: true,
    });
  });

  it('classifies matching topic messages from others as topic_inbound', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: '-1001',
        threadId: 42,
        senderId: '9',
        selfId: '1',
        text: 'hi',
        settings,
        knownOutboxTelegramIds: new Set(),
      }),
    ).toEqual({
      action: 'topic_inbound',
      originatedByOutbox: false,
      isUserbotSelf: false,
    });
  });

  it('still classifies private link codes when mirror settings are empty', () => {
    expect(
      classifyUserbotMessage({
        peerChatId: null,
        threadId: null,
        senderId: '9',
        selfId: '1',
        text: 'abc12345',
        settings: { chatId: '', topicId: null },
        knownOutboxTelegramIds: new Set(),
      }),
    ).toEqual({ action: 'link_code', code: 'abc12345' });
  });
});
