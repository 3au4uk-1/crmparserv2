import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDealDescription } from '../src/services/html-parser.js';
import { parseDealTitle } from '../src/services/title-parser.js';
import { isEventInRange } from '../src/utils/crm-dates.js';

const { tonyGet } = vi.hoisted(() => ({ tonyGet: vi.fn() }));

vi.mock('../src/services/tony-auth.js', () => ({
  getTonyConfig: () => ({ baseUrl: 'https://crm.apihide.com' }),
  tonyGet: (...args) => tonyGet(...args),
  isTonyAuthResponse: (resp) => {
    const location = String(resp?.headers?.location || '');
    if (Number(resp?.status) >= 300 && Number(resp?.status) < 400 && location.includes('/auth')) return true;
    return typeof resp?.data === 'string' && resp.data.includes('form_auth');
  },
}));

import {
  buildDescriptionHtml,
  fetchLogisticDescription,
  fetchLogisticEvents,
  parseActPositions,
  parseLogisticList,
  parseReserveStatusCode,
  resetLogisticsCache,
  selectLogisticEvents,
} from '../src/services/logistics-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const listHtml = readFileSync(join(__dirname, 'fixtures/logistic-list.html'), 'utf8');
const actHtml = readFileSync(join(__dirname, 'fixtures/orders-act-169120.html'), 'utf8');

const loadWindow = ['2026-06-16T00:00:00+03:00', '2026-06-20T23:59:59+03:00'];
const middleWindow = ['2026-06-17T00:00:00+03:00', '2026-06-19T23:59:59+03:00'];
const returnWindow = ['2026-06-20T00:00:00+03:00', '2026-06-21T23:59:59+03:00'];

describe('logistics order source', () => {
  beforeEach(() => {
    resetLogisticsCache();
    tonyGet.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('maps a reserve card onto the calendar event shape and skips middle days', () => {
    const orders = parseLogisticList(listHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    expect(orders.map((order) => order.id)).toEqual(['169120', '170000', '169121']);

    const events = selectLogisticEvents(orders, ...loadWindow);
    expect(events.map((event) => event.id)).toEqual(['169120', '170000']);
    expect(events[0]).toMatchObject({
      original_id: '169120',
      id: '169120',
      leadid: '777001',
      title: 'ПРО/16.06-20.06/ПЛОЩАДКА/169120/Шунькин',
      start: '2026-06-16T04:00:00+03:00',
      end: '2026-06-20T21:00:00+03:00',
    });
    expect(events[0].department).toBeUndefined();
    expect(parseDealTitle(events[0].title).companyCode).toBe('ПРО');
    expect(parseDealTitle(events[0].title).managerName).toBe('Шунькин');
    expect(isEventInRange(events[0], ...loadWindow)).toBe(true);

    expect(selectLogisticEvents(orders, ...middleWindow)).toEqual([]);

    const onReturn = selectLogisticEvents(orders, ...returnWindow);
    expect(onReturn).toHaveLength(1);
    expect(onReturn[0].start).toBe('2026-06-20T18:00:00+03:00');
    expect(isEventInRange(onReturn[0], ...returnWindow)).toBe(true);
  });

  it('builds the description HTML the calendar parser already understands', () => {
    const [order] = parseLogisticList(listHtml, { status: 200, headers: {} });
    const positions = parseActPositions(actHtml);
    expect(positions.map((item) => item.name)).toEqual(['Баннер', 'Ролл-ап']);

    const parsed = parseDealDescription(buildDescriptionHtml(order, positions));
    expect(parsed.meta.status).toBe('В резерве');
    expect(parsed.contact).toMatchObject({
      name: 'Чернов Михаил',
      company: 'ООО Ромашка',
      phone: '+7 (999) 111-22-33',
    });
    expect(parsed.event).toMatchObject({
      address: 'г Москва, Ленинградское шоссе, д 46',
      arrivalTime: '04:00',
      workTime: '18:00 - 21:00',
      dismantleTime: '21:00',
    });
    expect(parsed.items).toEqual([
      { name: 'Баннер', price: 1500, quantity: '2 шт.', discount: 0 },
      { name: 'Ролл-ап', price: 900, quantity: '1', discount: 10 },
    ]);
    expect(parsed.contact.email).toBe('');
    expect(parsed.meta.legalEntity).toBe('');
    expect(parsed.meta.invoiceNumber).toBe('');
    expect(parsed.meta.budget).toBeNull();
    expect(parsed.meta.discount).toBe('');
    const html = buildDescriptionHtml(order, positions);
    expect(html).not.toMatch(/E-Mail|Юр\.|№ cчета|Бюджет|Скидка:/);
  });

  it('requests only reserve orders and logs a masked snippet when the page is not the list', async () => {
    tonyGet.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: listHtml,
    });

    const events = await fetchLogisticEvents(...loadWindow);
    expect(events.map((event) => event.id)).toEqual(['169120', '170000']);
    const url = decodeURIComponent(tonyGet.mock.calls[0][0]);
    expect(url).toContain('https://crm.apihide.com/logistic/?');
    expect(url).toContain('date_range=16.06.2026');
    expect(url).toContain('date_range2=20.06.2026');
    expect(url).toContain('company=0');
    expect(url).toContain('status[]=5');

    const body = 'Session PHPSESSID=abc123session hash=secrethash call +7 (999) 123-45-67';
    tonyGet.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: body,
    });
    await expect(fetchLogisticEvents(...loadWindow)).rejects.toThrow(/unexpected body/);
    await expect(fetchLogisticEvents(...loadWindow)).rejects.toThrow(/status=200/);
    await expect(fetchLogisticEvents(...loadWindow)).rejects.toThrow(/content-type=text\/plain/);
    await expect(fetchLogisticEvents(...loadWindow)).rejects.toThrow(new RegExp(`length=${body.length}`));
    try {
      await fetchLogisticEvents(...loadWindow);
    } catch (err) {
      expect(err.message).not.toContain('abc123session');
      expect(err.message).not.toContain('secrethash');
      expect(err.message).not.toContain('123-45-67');
      expect(err.message).not.toContain('999');
    }
  });

  it('loads act positions into the description response', async () => {
    const [order] = parseLogisticList(listHtml, { status: 200, headers: {} });
    tonyGet.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: listHtml,
    });
    await fetchLogisticEvents(...loadWindow);
    tonyGet.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: actHtml,
    });

    const description = await fetchLogisticDescription(order.id);
    expect(description.payments).toBeNull();
    expect(parseDealDescription(description.description).items).toHaveLength(2);
    expect(tonyGet.mock.calls.at(-1)[0]).toBe('https://crm.apihide.com/orders/orders_act/?id=169120');
  });

  it('reads «В резерве» from the filter checkbox and falls back to 5', () => {
    const labeled = `
      <label><input type="checkbox" name="status[]" value="5"> Вернулся</label>
      <label><input type="checkbox" name="status[]" value="7"> В резерве</label>
    `;
    expect(parseReserveStatusCode(labeled)).toBe('7');
    expect(parseReserveStatusCode('<label><input type="checkbox" name="status[]" value="4" id="s4"></label><label for="s4">В резерве</label>')).toBe('4');
    expect(parseReserveStatusCode(listHtml)).toBe('5');
    expect(parseReserveStatusCode('<form><input name="date_range"></form>', '5')).toBe('5');
  });

  it('refetches the list once when the reserve checkbox is not 5', async () => {
    const form = `
      <form>
        <input name="date_range" value="16.06.2026">
        <input name="date_range2" value="20.06.2026">
        <label><input type="checkbox" name="status[]" value="1"> Новый</label>
        <label><input type="checkbox" name="status[]" value="7"> В резерве</label>
      </form>
    `;
    const card = listHtml.replace('data-order-status="5"', 'data-order-status="7"');
    tonyGet
      .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html' }, data: form })
      .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html' }, data: `${form}${card}` });

    const events = await fetchLogisticEvents(...loadWindow);
    expect(tonyGet).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(tonyGet.mock.calls[0][0])).toContain('status[]=5');
    expect(decodeURIComponent(tonyGet.mock.calls[1][0])).toContain('status[]=7');
    expect(events.map((event) => event.id)).toEqual(['169120', '170000']);
  });

  it('keeps every card from the reserve page and ignores logistics badges', () => {
    const html = `
      <form>
        <input name="date_range">
        <div class="checkbox">
          <input type="checkbox" name="status[]" value="5">
          <span>В&nbsp;РЕЗЕРВЕ</span>
        </div>
      </form>
      <div class="order-card" data-order-id="180001" data-deal-id="9" data-order-status="in_progress">
        <div class="card-header"><div class="ref"><a href="/orders/orders_edit/?id=180001">ID: ПРО/20.10/180001/Иванов / Клиент</a></div></div>
        <div class="status-indicator" data-status="new">В работе</div>
        <div class="meta"><div class="order-info-line">📅 Загрузка: 20.10.2026 09:00 ➡️ Возврат: 21.10.2026 18:00 - 19:00</div></div>
      </div>
      <div class="order-card" data-order-id="180002" data-deal-id="10" data-order-status="done">
        <div class="card-header"><div class="ref"><a href="/orders/orders_edit/?id=180002">ID: АРТ/20.10/180002/Петров / Клиент</a></div></div>
        <div class="status-indicator" data-status="done">Выполнен</div>
        <div class="meta"><div class="order-info-line">📅 Загрузка: 20.10.2026 10:00 ➡️ Возврат: 20.10.2026 12:00 - 13:00</div></div>
      </div>
    `;
    const orders = parseLogisticList(html, { status: 200, headers: {} });
    const events = selectLogisticEvents(orders, '2026-10-20T00:00:00+03:00', '2026-11-03T23:59:59+03:00');
    expect(events.map((event) => event.id)).toEqual(['180001', '180002']);
    for (const order of orders) order.dealStatus = 'В резерве';
    expect(parseDealDescription(buildDescriptionHtml(orders[0], [])).meta.status).toBe('В резерве');
    expect(parseReserveStatusCode(html)).toBe('5');
  });

  it('reads a nested or sibling «резерв» label in any case', () => {
    expect(parseReserveStatusCode(`
      <label><input type="checkbox" name="status[]" value="8"><span>В РЕЗЕРВЕ</span></label>
    `)).toBe('8');
    expect(parseReserveStatusCode(`
      <table><tr>
        <td><input type="checkbox" name="status[]" value="3"></td>
        <td><span>в резерве</span></td>
      </tr></table>
    `)).toBe('3');
    expect(parseReserveStatusCode(`
      <div class="filter">
        <label for="st"><span>Резерв</span></label>
        <input id="st" type="checkbox" name="status[]" value="9">
      </div>
    `)).toBe('9');
  });
});
