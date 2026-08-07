import Database from 'better-sqlite3';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  handleDigestCommandEvent,
  initDigestCommands,
  resolveMessageThreadId,
} from '../src/telegram/userbot/digest-commands.js';

const runDigestForDayMock = vi.fn();
const sendDigestTextMock = vi.fn();
const getTelegramDestinationMock = vi.fn();

vi.mock('../src/telegram/digest/run.js', () => ({
  runDigestForDay: (...args) => runDigestForDayMock(...args),
}));

vi.mock('../src/telegram/digest/send.js', () => ({
  sendDigestText: (...args) => sendDigestTextMock(...args),
}));

vi.mock('../src/telegram/settings.js', () => ({
  getTelegramDestination: (...args) => getTelegramDestinationMock(...args),
}));

function memDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  return db;
}

const dest = { chatId: '-1001', threadId: 42 };
const client = { sendMessage: vi.fn() };

function digestMessage(overrides = {}) {
  return {
    message: '/завтра',
    peerId: { channelId: 1n },
    replyTo: { forumTopic: true, replyToMsgId: 42 },
    ...overrides,
  };
}

describe('resolveMessageThreadId', () => {
  it('returns topic root id for forumTopic replies', () => {
    expect(
      resolveMessageThreadId({
        replyTo: { forumTopic: true, replyToMsgId: 42 },
      }),
    ).toBe(42);
  });

  it('returns null when reply is not a forum topic', () => {
    expect(resolveMessageThreadId({ replyTo: { replyToMsgId: 42 } })).toBe(null);
    expect(resolveMessageThreadId({})).toBe(null);
  });
});

describe('handleDigestCommandEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTelegramDestinationMock.mockReturnValue(dest);
    runDigestForDayMock.mockResolvedValue({ ok: true, text: 'digest' });
    sendDigestTextMock.mockResolvedValue(undefined);
  });

  it('ignores non-command messages', async () => {
    const db = memDb();
    await handleDigestCommandEvent({
      client,
      db,
      message: digestMessage({ message: 'hello' }),
    });
    expect(runDigestForDayMock).not.toHaveBeenCalled();
  });

  it('ignores commands from wrong chat or topic', async () => {
    const db = memDb();
    await handleDigestCommandEvent({
      client,
      db,
      message: digestMessage({ peerId: { channelId: 2n } }),
    });
    await handleDigestCommandEvent({
      client,
      db,
      message: digestMessage({ replyTo: { forumTopic: true, replyToMsgId: 99 } }),
    });
    expect(runDigestForDayMock).not.toHaveBeenCalled();
  });

  it('runs digest for /завтра in digest.morning dest', async () => {
    const db = memDb();
    await handleDigestCommandEvent({ client, db, message: digestMessage() });
    expect(runDigestForDayMock).toHaveBeenCalledWith({ db, offsetDays: 1 });
    expect(sendDigestTextMock).not.toHaveBeenCalled();
  });

  it('runs digest for /послезавтра with offsetDays 2', async () => {
    const db = memDb();
    await handleDigestCommandEvent({
      client,
      db,
      message: digestMessage({ message: '/послезавтра' }),
    });
    expect(runDigestForDayMock).toHaveBeenCalledWith({ db, offsetDays: 2 });
  });

  it('sends error to dest when runDigestForDay returns ok:false', async () => {
    runDigestForDayMock.mockResolvedValue({ ok: false, error: 'fetch failed' });
    const db = memDb();
    await handleDigestCommandEvent({ client, db, message: digestMessage() });
    expect(sendDigestTextMock).toHaveBeenCalledWith({
      client,
      chatId: '-1001',
      threadId: 42,
      text: 'не удалось загрузить',
    });
  });

  it('sends error to dest when runDigestForDay throws', async () => {
    runDigestForDayMock.mockRejectedValue(new Error('boom'));
    const db = memDb();
    await handleDigestCommandEvent({ client, db, message: digestMessage() });
    expect(sendDigestTextMock).toHaveBeenCalledWith({
      client,
      chatId: '-1001',
      threadId: 42,
      text: 'не удалось загрузить',
    });
  });
});

describe('initDigestCommands', () => {
  it('attaches a NewMessage handler once per client', () => {
    const hooks = [];
    const testClient = { addEventHandler: vi.fn() };
    initDigestCommands({ onClientReady: (fn) => hooks.push(fn) });

    expect(hooks).toHaveLength(1);
    hooks[0](testClient);
    hooks[0](testClient);
    expect(testClient.addEventHandler).toHaveBeenCalledTimes(1);
  });
});
