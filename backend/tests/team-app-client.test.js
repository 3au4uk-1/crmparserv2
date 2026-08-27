import { describe, expect, it, vi } from 'vitest';
import { teamAppConsumeLink, teamAppIngest } from '../src/telegram/team-app-client.js';

describe('teamAppIngest', () => {
  it('POSTs JSON to telegram-inbound with X-Chat-Secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ duplicate: false }),
    });
    const body = {
      telegramMessageId: '1',
      telegramUserId: '9',
      telegramDisplayName: 'A',
      kind: 'text',
      body: 'hi',
      isUserbotSelf: false,
      originatedByOutbox: false,
    };
    const result = await teamAppIngest(
      { teamAppBaseUrl: 'http://team-app:3001', teamAppChatSecret: 's3cret' },
      body,
      fetchImpl,
    );
    expect(result).toEqual({ duplicate: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://team-app:3001/internal/chat/telegram-inbound');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Chat-Secret']).toBe('s3cret');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('strips trailing slash on TEAM_APP_BASE_URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    await teamAppIngest(
      { teamAppBaseUrl: 'http://team-app:3001/', teamAppChatSecret: 's' },
      { body: 'hi' },
      fetchImpl,
    );
    expect(fetchImpl.mock.calls[0][0]).toBe('http://team-app:3001/internal/chat/telegram-inbound');
  });
});

describe('teamAppConsumeLink', () => {
  it('POSTs code and telegramUserId to link-consume', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, userId: 'u1' }),
    });
    const result = await teamAppConsumeLink(
      { teamAppBaseUrl: 'http://team-app:3001', teamAppChatSecret: 's3cret' },
      { code: 'ABC12345', telegramUserId: '9' },
      fetchImpl,
    );
    expect(result).toEqual({ ok: true, userId: 'u1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://team-app:3001/internal/chat/link-consume');
    expect(init.headers['X-Chat-Secret']).toBe('s3cret');
    expect(JSON.parse(init.body)).toEqual({ code: 'ABC12345', telegramUserId: '9' });
  });
});
