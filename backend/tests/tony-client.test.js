import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchTonyOrderHtml } from '../src/services/tony-client.js';

vi.mock('axios');
vi.mock('../src/services/tony-auth.js', () => ({
  getTonyConfig: () => ({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'p' }),
  tonyRequestHeaders: () => ({ Cookie: 'PHPSESSID=abc' }),
}));
const ROW_HTML =
  '<tr data-id="1" data-price="100" data-sum="200">' +
  '<td><input class="custom_name_value" value="Баннер"></td>' +
  '<td><input class="orders_custom_edit" value="2"></td>' +
  '<td><input class="price_value" value="100"></td>' +
  '<td><input class="discount_value" value="0"></td></tr>';

describe('fetchTonyOrderHtml', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns page HTML plus AJAX-loaded category tables', async () => {
    axios.get.mockResolvedValue({ status: 200, data: '<html>Заказ №169120</html>' });
    axios.post.mockResolvedValue({ status: 200, data: { success: true, html: ROW_HTML } });

    const html = await fetchTonyOrderHtml('169120');
    expect(html).toContain('169120');
    expect(html).toContain('data-var="products"');
    expect(html).toContain('Баннер');
    expect(axios.get).toHaveBeenCalledWith(
      'https://crm.apihide.com/orders/orders_edit/?id=169120',
      expect.any(Object)
    );
    expect(axios.post).toHaveBeenCalledWith(
      'https://crm.apihide.com/ajax/order_products_list.php',
      expect.stringContaining('id=169120'),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'PHPSESSID=abc' }) })
    );
  });

  it('returns null for a 404 (invalid booking number)', async () => {
    axios.get.mockResolvedValue({ status: 404, data: 'Not Found' });
    const html = await fetchTonyOrderHtml('999999');
    expect(html).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns null for a redirect to /notfound/ (invalid order id)', async () => {
    axios.get.mockResolvedValue({ status: 302, headers: { location: '/notfound/' }, data: '' });
    const html = await fetchTonyOrderHtml('35682');
    expect(html).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('throws on a redirect to login (expired session)', async () => {
    axios.get.mockResolvedValue({ status: 302, headers: { location: '/auth/' }, data: '' });
    await expect(fetchTonyOrderHtml('169120')).rejects.toThrow(/session/i);
  });

  it('requests all 8 product categories plus sklad in one order fetch', async () => {
    axios.get.mockResolvedValue({ status: 200, data: '<html>Заказ №169120</html>' });
    axios.post.mockResolvedValue({ status: 200, data: { success: true, html: ROW_HTML } });

    await fetchTonyOrderHtml('169120');

    expect(axios.post).toHaveBeenCalledTimes(9);
    const actionVars = axios.post.mock.calls.map(
      (c) => new URLSearchParams(c[1]).get('actionVar')
    );
    expect(actionVars).toEqual(
      expect.arrayContaining(['food', 'products', 'tech', 'personnel', 'services', 'assembly', 'transport', 'expense'])
    );
  });
});
