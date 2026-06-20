// backend/tests/parser-prefetch.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../src/services/auth.js', () => ({
  getCalToken: () => 'tok',
  getCrmRequestHeaders: () => ({}),
}));
vi.mock('../src/services/tony-auth.js', () => ({
  getTonyConfig: () => ({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'p' }),
  tonyRequestHeaders: () => ({ Cookie: 'PHPSESSID=abc' }),
}));
vi.mock('../src/config.js', () => ({
  config: { crmBaseUrl: 'https://apihide.com/bitrix/calendar/', fetchConcurrency: 4, parsePipeline: 'parallel' },
}));

import { createPool } from '../src/services/fetch-pool.js';
import { fetchEventData, prefetchAll } from '../src/services/parser.js';

const DESC = JSON.stringify({ description: '<div>contact</div>' });
const PAGE = '<html><input name="date_install" value="01.01.2026"></html>';
const ROW = '<tr data-id="1" data-price="100" data-sum="200"><td><input class="custom_name_value" value="Баннер"></td><td><input class="orders_custom_edit" value="2"></td></tr>';

function wireAxios() {
  axios.post.mockImplementation((url) => {
    if (url.includes('cal_description.php')) return Promise.resolve({ status: 200, data: DESC });
    if (url.includes('order_products_list.php')) return Promise.resolve({ status: 200, data: { html: ROW } });
    if (url.includes('order_sklad_list.php')) return Promise.resolve({ status: 200, data: { html: '' } });
    return Promise.resolve({ status: 200, data: {} });
  });
  axios.get.mockResolvedValue({ status: 200, data: PAGE });
}

const events = [{ id: 100, title: 'ООО Ромашка 169120', start: '2026-01-01', end: '2026-01-02' }];
const start = new Date('2026-01-01T00:00:00+03:00');
const end = new Date('2026-01-03T00:00:00+03:00');

describe('prefetchAll vs fetchEventData equivalence', () => {
  beforeEach(() => { vi.clearAllMocks(); wireAxios(); });

  it('produces the same per-event data as the legacy sequential fetch', async () => {
    const legacy = await fetchEventData(events[0], '100', true);

    vi.clearAllMocks(); wireAxios();
    const run = createPool({ concurrency: 4 });
    const map = await prefetchAll(events, true, start, end, run);
    const parallel = map.get('100');

    expect(parallel.descHtml).toBe(legacy.descHtml);
    expect(parallel.bookingNumbers).toEqual(legacy.bookingNumbers);
    expect([...parallel.tonyOrders.keys()]).toEqual([...legacy.tonyOrders.keys()]);
    expect(parallel.tonyOrders.get('169120').items).toEqual(legacy.tonyOrders.get('169120').items);
    expect(parallel.calParsed.contact).toEqual(legacy.calParsed.contact);
  });
});
