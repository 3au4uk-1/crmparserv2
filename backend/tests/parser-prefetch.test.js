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
  config: { crmBaseUrl: 'https://apihide.com/bitrix/calendar/', fetchConcurrency: 4, parsePipeline: 'parallel', tonyUnchangedProbe: false },
}));

import { createPool } from '../src/services/fetch-pool.js';
import { fetchEventData, prefetchAll } from '../src/services/parser.js';

const DESC = JSON.stringify({ description: '<div>contact</div>' });
const PAGE = '<html><input name="date_install" value="01.01.2026"></html>';
const ROW = '<tr data-id="1" data-price="100" data-sum="200"><td><input class="custom_name_value" value="Баннер"></td><td><input class="orders_custom_edit" value="2"></td></tr>';

function wireAxios() {
  axios.post.mockImplementation((url) => {
    if (url.includes('cal_description.php')) return Promise.resolve({ status: 200, data: DESC });
    if (url.includes('order_get_info.php')) {
      return Promise.resolve({
        status: 200,
        data: { success: true, data: { timestamps: { updated_at: '2026-09-15 12:39:09' }, deleted: false } },
      });
    }
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

describe('prefetchAll Tony unchanged skip', () => {
  it('does not fetch orders_edit or category tables when stamp matches', async () => {
    const stamps = new Map([
      ['169120', { stamp: '2026-09-15 12:39:09', dataSource: 'tony' }],
    ]);
    const stats = { tony_probe: 0, tony_skip: 0, tony_full: 0, tony_probe_fail: 0 };
    const run = createPool({ concurrency: 4 });
    vi.clearAllMocks();
    wireAxios();
    const map = await prefetchAll(events, true, start, end, run, {
      stamps,
      probeEnabled: true,
      stats,
    });
    expect(map.get('100').tonyOrders.has('169120')).toBe(false);
    expect(stats.tony_skip).toBe(1);
    expect(stats.tony_full).toBe(0);
    expect(axios.get.mock.calls.some((c) => String(c[0]).includes('orders_edit'))).toBe(false);
    const listPosts = axios.post.mock.calls.filter((c) => String(c[0]).includes('order_products_list.php'));
    expect(listPosts).toHaveLength(0);
    const descPosts = axios.post.mock.calls.filter((c) => String(c[0]).includes('cal_description.php'));
    expect(descPosts.length).toBeGreaterThan(0);
  });

  it('omits booking and counts probe fail when order_get_info is unusable', async () => {
    const stats = { tony_probe: 0, tony_skip: 0, tony_full: 0, tony_probe_fail: 0 };
    const run = createPool({ concurrency: 4 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
    wireAxios();
    axios.post.mockImplementation((url) => {
      if (url.includes('cal_description.php')) return Promise.resolve({ status: 200, data: DESC });
      if (url.includes('order_get_info.php')) {
        return Promise.resolve({ status: 200, data: { success: false } });
      }
      if (url.includes('order_products_list.php')) return Promise.resolve({ status: 200, data: { html: ROW } });
      if (url.includes('order_sklad_list.php')) return Promise.resolve({ status: 200, data: { html: '' } });
      return Promise.resolve({ status: 200, data: {} });
    });
    const map = await prefetchAll(events, true, start, end, run, {
      probeEnabled: true,
      stats,
    });
    expect(map.get('100').tonyOrders.has('169120')).toBe(false);
    expect(stats.tony_probe_fail).toBe(1);
    expect(stats.tony_full).toBe(0);
    expect(axios.get.mock.calls.some((c) => String(c[0]).includes('orders_edit'))).toBe(false);
    expect(errSpy).toHaveBeenCalledWith('[tony] probe returned no usable data for order 169120');
    errSpy.mockRestore();
  });

  it('attaches probe stamp and fetches full Tony when stored stamp differs', async () => {
    const stamps = new Map([
      ['169120', { stamp: 'old', dataSource: 'tony' }],
    ]);
    const stats = { tony_probe: 0, tony_skip: 0, tony_full: 0, tony_probe_fail: 0 };
    const run = createPool({ concurrency: 4 });
    vi.clearAllMocks();
    wireAxios();
    const map = await prefetchAll(events, true, start, end, run, {
      stamps,
      probeEnabled: true,
      stats,
    });
    expect(map.get('100').tonyOrders.get('169120').tonyUpdatedAt).toBe('2026-09-15 12:39:09');
    expect(stats.tony_probe).toBe(1);
    expect(stats.tony_full).toBe(1);
    expect(stats.tony_skip).toBe(0);
    expect(axios.get.mock.calls.some((c) => String(c[0]).includes('orders_edit'))).toBe(true);
    const listPosts = axios.post.mock.calls.filter((c) => String(c[0]).includes('order_products_list.php'));
    expect(listPosts.length).toBeGreaterThan(0);
  });
});
