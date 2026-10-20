import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../src/config.js', () => ({
  config: {
    tonyBaseUrl: 'https://crm.apihide.com',
    tonyLogin: '',
    tonyPassword: '',
    crmLogin: 'crm-user',
    crmPassword: 'crm-pass',
  },
}));

import { tonyLogin, tonyGet, getTonyCookies, getTonyConfig, resetTonyAuth } from '../src/services/tony-auth.js';

describe('tony-auth', () => {
  beforeEach(() => {
    resetTonyAuth();
    vi.clearAllMocks();
  });

  it('falls back to CRM_LOGIN and CRM_PASSWORD when Tony credentials are empty', () => {
    expect(getTonyConfig()).toMatchObject({
      baseUrl: 'https://crm.apihide.com',
      login: 'crm-user',
      password: 'crm-pass',
    });
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
      'login=u&password=p&redirect=%2Flogistic%2F',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    );
    expect(getTonyCookies()).toBe('PHPSESSID=abc123; other=1');
  });

  it('logs in once and retries when the session redirects to /auth/', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      headers: { 'set-cookie': ['PHPSESSID=newsession; path=/'] },
      data: { success: true },
    });
    axios.get
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: '/auth/?redirect=%2Flogistic%2F' },
        data: '',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: '<html><input name="date_range"></html>',
      });

    const resp = await tonyGet('https://crm.apihide.com/logistic/');

    expect(resp.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(getTonyCookies()).toContain('PHPSESSID=newsession');
  });

  it('throws when no set-cookie is returned (bad credentials)', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: 'Неверный логин' });
    await expect(
      tonyLogin({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'bad' })
    ).rejects.toThrow(/Tony login failed/);
  });
});
