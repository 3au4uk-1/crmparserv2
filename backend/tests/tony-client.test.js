import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchTonyOrderHtml } from '../src/services/tony-client.js';

vi.mock('axios');
vi.mock('../src/services/tony-auth.js', () => ({
  getTonyConfig: () => ({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'p' }),
  tonyRequestHeaders: () => ({ Cookie: 'PHPSESSID=abc' }),
}));

describe('fetchTonyOrderHtml', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns HTML for an existing order', async () => {
    axios.get.mockResolvedValue({ status: 200, data: '<html>Заказ №169120</html>' });
    const html = await fetchTonyOrderHtml('169120');
    expect(html).toContain('169120');
    expect(axios.get).toHaveBeenCalledWith(
      'https://crm.apihide.com/orders/orders_edit/?id=169120',
      expect.any(Object)
    );
  });

  it('returns null for a 404 (invalid booking number)', async () => {
    axios.get.mockResolvedValue({ status: 404, data: 'Not Found' });
    const html = await fetchTonyOrderHtml('999999');
    expect(html).toBeNull();
  });
});
