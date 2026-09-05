import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pollOnce } from '../src/telegram/polling.js';

let testDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

function openDb({ token = '123:abc' } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  if (token) {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`).run(token);
  }
  return db;
}

describe('telegram polling', () => {
  beforeEach(() => {
    testDb = openDb();
  });

  it('is idle without bot token', async () => {
    testDb = openDb({ token: null });
    const call = vi.fn();
    const state = { offset: 0, webhookCleared: false };
    const result = await pollOnce(testDb, state, { callTelegram: call });
    expect(result.idle).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('deletes webhook once, then long-polls getUpdates', async () => {
    const call = vi.fn().mockImplementation(async (token, method) => {
      if (method === 'deleteWebhook') return true;
      return [];
    });
    const state = { offset: 0, webhookCleared: false };

    await pollOnce(testDb, state, { callTelegram: call });
    await pollOnce(testDb, state, { callTelegram: call });

    const deleteCalls = call.mock.calls.filter(([, method]) => method === 'deleteWebhook');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][2]).toEqual({ drop_pending_updates: false });

    const updateCalls = call.mock.calls.filter(([, method]) => method === 'getUpdates');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][2]).toMatchObject({
      offset: 0,
      timeout: 30,
      allowed_updates: ['message', 'channel_post', 'my_chat_member'],
    });
  });

  it('processes updates and advances offset past failures', async () => {
    const updates = [
      { update_id: 10, message: { chat: { id: -1, type: 'group', title: 'A' } } },
      { update_id: 11, my_chat_member: { chat: { id: -2, type: 'group' } } },
    ];
    const call = vi.fn().mockImplementation(async (token, method) =>
      method === 'getUpdates' ? updates : true,
    );
    const processed = [];
    const process = vi.fn(async (db, update) => {
      await Promise.resolve();
      processed.push(update.update_id);
      if (update.update_id === 10) throw new Error('boom');
    });
    const state = { offset: 0, webhookCleared: true };

    await pollOnce(testDb, state, { callTelegram: call, processTelegramUpdate: process });

    expect(processed).toEqual([10, 11]);
    expect(state.offset).toBe(12);
  });
});
