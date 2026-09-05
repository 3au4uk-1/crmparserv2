import { describe, expect, it, vi } from 'vitest';
import {
  telegramMessageUrl,
  createTelegramRequest,
  updateTelegramRequest,
} from '../src/telegram/work-requests/twenty.js';

describe('telegramMessageUrl', () => {
  it('builds t.me/c link from bot-api chat id', () => {
    expect(telegramMessageUrl('-1001234567890', 42)).toBe('https://t.me/c/1234567890/42');
  });
});

describe('createTelegramRequest', () => {
  it('sends createTelegramRequest mutation', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { createTelegramRequest: { id: 'rec-1' } } },
    });
    const id = await createTelegramRequest(gql, { name: 'Запрос #1', stage: 'NEW', kind: 'QUOTE' });
    expect(id).toBe('rec-1');
    expect(gql.mock.calls[0][0]).toMatch(/createTelegramRequest/);
    expect(gql.mock.calls[0][1]).toEqual({
      data: { name: 'Запрос #1', stage: 'NEW', kind: 'QUOTE' },
    });
  });
});

describe('updateTelegramRequest', () => {
  it('sends updateTelegramRequest mutation', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { updateTelegramRequest: { id: 'rec-1' } } },
    });
    const result = await updateTelegramRequest(gql, 'rec-1', { stage: 'DONE' });
    expect(result).toEqual({ id: 'rec-1' });
    expect(gql.mock.calls[0][0]).toMatch(/updateTelegramRequest/);
    expect(gql.mock.calls[0][1]).toEqual({ id: 'rec-1', data: { stage: 'DONE' } });
  });
});
