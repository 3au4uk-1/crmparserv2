import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { tonyLogin, getTonyCookies, resetTonyAuth } from '../src/services/tony-auth.js';

vi.mock('axios');

describe('tony-auth', () => {
  beforeEach(() => {
    resetTonyAuth();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts credentials to /ajax/login.php and stores session cookie', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: { 'set-cookie': ['PHPSESSID=abc123; path=/; HttpOnly', 'other=1; path=/'] },
      data: '',
    });

    await tonyLogin({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'p' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://crm.apihide.com/ajax/login.php',
      'login=u&password=p',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    );
    expect(getTonyCookies()).toBe('PHPSESSID=abc123; other=1');
  });

  it('throws when no set-cookie is returned (bad credentials)', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: 'Неверный логин' });
    await expect(
      tonyLogin({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'bad' })
    ).rejects.toThrow(/Tony login failed/);
  });
});
