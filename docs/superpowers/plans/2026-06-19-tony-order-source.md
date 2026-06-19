# Tony as Order Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the internal calendar a deal-discovery source only, and pull order data (positions with separate price/quantity, load date, event/dismount dates, address, budget) from Tony (`crm.apihide.com`) as the source of truth, with fallback to calendar when there is no booking number.

**Architecture:** Keep the calendar discovery (`fetchEvents`) unchanged. For each calendar event, extract all booking numbers from the title; for each valid Tony order (HTTP 200) create/update a deal sourced from Tony, otherwise fall back to the current calendar parsing. Multiple booking numbers split into separate deals keyed by `deal_key = "<crm_event_id>#<booking>"`. All Tony logic lives in new isolated modules (`tony-auth`, `tony-client`, `tony-parser`, `booking-numbers`, `tony-mapping`, `tony-reconcile`).

**Tech Stack:** Node.js (ESM), Express, better-sqlite3, axios, cheerio, vitest. Run tests from `backend/` with `npm test`.

---

## Confirmed facts from live Tony investigation (use these exact selectors/endpoints)

- **Login:** `POST {tonyBaseUrl}/ajax/login.php` with `application/x-www-form-urlencoded` body `login=<...>&password=<...>`. Response sets a session cookie (capture `set-cookie`).
- **Order page:** `GET {tonyBaseUrl}/orders/orders_edit/?id=<bookingNumber>`. HTTP 404 when the order does not exist. Fully server-rendered.
- **Position tables:** every `table[data-src="order_products_list"]`; category = table attribute `data-var` (observed values: `products`, `tech`, `food`, `personnel`, `services`, `assembly`, `transport`, `expense`).
- **Position row:** `tr[data-id][data-price][data-sum]` inside those tables. Within a row:
  - name = `input.custom_name_value` `value` attr (fallback: `.custom_name_title` text)
  - quantity = `input.orders_custom_edit` `value` attr (string, may be e.g. `"9"`)
  - unit price = `tr` `data-price` attr (fallback: `input.price_value` `value`)
  - discount % = `input.discount_value` `value` attr
  - line sum = `tr` `data-sum` attr
- **Date inputs (by `name`):** `date_install` (= Дата загрузки), `date_install_time` (= Время загрузки), `date_event_begin`, `date_event_end`, `date_deinstall`, `date_deinstall_time`, `work_time_begin`, `work_time_end`.
- **Address:** `input[name="client_address"]` (label "Место проведения").

---

## File Structure

**Create:**
- `backend/src/services/booking-numbers.js` — extract all booking numbers from a title.
- `backend/src/services/tony-auth.js` — Tony login/session management.
- `backend/src/services/tony-client.js` — fetch an order page by booking number.
- `backend/src/services/tony-parser.js` — parse positions/dates/address/budget from order HTML.
- `backend/src/services/tony-mapping.js` — map parsed Tony order → deal column values + content hash.
- `backend/src/services/tony-reconcile.js` — compute desired deal keys and reconcile deals per event.
- `backend/tests/fixtures/tony-order-169120.html` — trimmed real order HTML fixture.
- `backend/tests/booking-numbers.test.js`
- `backend/tests/tony-parser.test.js`
- `backend/tests/tony-auth.test.js`
- `backend/tests/tony-client.test.js`
- `backend/tests/tony-mapping.test.js`
- `backend/tests/tony-reconcile.test.js`

**Modify:**
- `backend/src/db/schema.sql` — new columns + drop UNIQUE on `crm_event_id` + unique index on `deal_key`.
- `backend/src/db/migrate.js` — migrate existing DBs to the new deal identity.
- `backend/src/config.js` + `.env.example` — Tony base URL/login/password.
- `backend/src/services/parser.js` — orchestrate source selection + reconciliation.
- `backend/src/services/twenty-opportunity.js` — add load date + price×quantity amount.
- `backend/src/routes/settings.js` + `frontend/src/pages/Settings.jsx` — Tony credentials UI.
- `backend/tests/twenty-opportunity.test.js` (create if missing) — load date / amount tests.

---

## Task 1: Extract all booking numbers from title

**Files:**
- Create: `backend/src/services/booking-numbers.js`
- Test: `backend/tests/booking-numbers.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/booking-numbers.test.js
import { describe, it, expect } from 'vitest';
import { extractBookingNumbers } from '../src/services/booking-numbers.js';

describe('extractBookingNumbers', () => {
  it('returns empty array for missing/empty title', () => {
    expect(extractBookingNumbers(null)).toEqual([]);
    expect(extractBookingNumbers('')).toEqual([]);
  });

  it('returns empty array when no 5-7 digit number present', () => {
    expect(extractBookingNumbers('ПРО/06.05/Иванов')).toEqual([]);
  });

  it('extracts a single booking number', () => {
    expect(extractBookingNumbers('АРТ/06.05/Владислава мебель/167099/Клепикова')).toEqual(['167099']);
  });

  it('extracts multiple booking numbers in order', () => {
    expect(
      extractBookingNumbers('ПРО/КАПЫ/167015 /ДОЗАБОР/168973/Шунькин')
    ).toEqual(['167015', '168973']);
  });

  it('deduplicates repeated numbers preserving first occurrence', () => {
    expect(extractBookingNumbers('ПРО/167015/повтор 167015/Шунькин')).toEqual(['167015']);
  });

  it('ignores 8+ digit numbers (phones) and 1-4 digit numbers (dates)', () => {
    expect(extractBookingNumbers('ПРО/06.05/тел 89261234567/Иванов')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/booking-numbers.test.js`
Expected: FAIL — `extractBookingNumbers` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/booking-numbers.js

/** Extract all 5-7 digit booking numbers from a deal title, de-duplicated, order preserved. */
export function extractBookingNumbers(title) {
  if (!title) return [];
  const matches = String(title).match(/\b\d{5,7}\b/g) || [];
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      result.push(m);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/booking-numbers.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/booking-numbers.js backend/tests/booking-numbers.test.js
git commit -m "feat: extract all booking numbers from deal title"
```

---

## Task 2: Create the Tony order HTML fixture

**Files:**
- Create: `backend/tests/fixtures/tony-order-169120.html`

This fixture is a minimal but realistic slice of a Tony order page covering two category tables, the date inputs, and the address input. Later parser tests depend on it.

- [ ] **Step 1: Create the fixture file**

```html
<!-- backend/tests/fixtures/tony-order-169120.html -->
<!DOCTYPE html>
<html><head><title>Заказ №169120</title></head><body>
<input type="text" name="date_install" value="16.06.2026">
<input type="text" name="date_install_time" value="04:00">
<input type="text" name="date_event_begin" value="16.06.2026">
<input type="text" name="date_event_end" value="17.06.2026">
<input type="text" name="date_deinstall" value="17.06.2026">
<input type="text" name="date_deinstall_time" value="01:00">
<input type="text" name="work_time_begin" value="11:00">
<input type="text" name="work_time_end" value="21:00">
<input type="text" id="client_address" name="client_address" value="г Москва, Ленинградское шоссе, д 46">

<table class="table-type1" id="order_products_list" data-src="order_products_list" data-var="products">
  <tr><th>Название</th><th>Комментарий</th><th>Количество</th><th>Цена</th></tr>
  <tr data-id="821679" data-price="2640.00" data-sum="23760">
    <td>
      <div class="custom_name_title">Навигационные наклейки</div>
      <div class="custom_name_edit"><input type="text" value="Навигационные наклейки" class="custom_name_value"></div>
      <div class="warehouse-name">Декор</div>
    </td>
    <td><input type="text" value="+ монтаж" class="custom_text_value"></td>
    <td><div class="count-block"><input type="number" value="9" class="orders_custom_edit" data-item-id="821679"></div></td>
    <td><input type="text" value="2640" class="price_value price_custom"></td>
    <td><input type="text" value="0" class="discount_value discount_custom"></td>
  </tr>
  <tr data-id="822814" data-price="14400.00" data-sum="14400">
    <td>
      <div class="custom_name_title">Ролл апп 85х200</div>
      <div class="custom_name_edit"><input type="text" value="Ролл апп 85х200" class="custom_name_value"></div>
      <div class="warehouse-name">Декор</div>
    </td>
    <td><input type="text" value="" class="custom_text_value"></td>
    <td><div class="count-block"><input type="number" value="1" class="orders_custom_edit" data-item-id="822814"></div></td>
    <td><input type="text" value="14400" class="price_value price_custom"></td>
    <td><input type="text" value="10" class="discount_value discount_custom"></td>
  </tr>
</table>

<table class="table-type1" id="order_personnel_list" data-src="order_products_list" data-var="personnel">
  <tr><th>Название</th></tr>
  <tr data-id="900001" data-price="5000.00" data-sum="5000">
    <td>
      <div class="custom_name_title">Монтажник</div>
      <div class="custom_name_edit"><input type="text" value="Монтажник" class="custom_name_value"></div>
    </td>
    <td><input type="text" value="" class="custom_text_value"></td>
    <td><div class="count-block"><input type="number" value="1" class="orders_custom_edit" data-item-id="900001"></div></td>
    <td><input type="text" value="5000" class="price_value price_custom"></td>
    <td><input type="text" value="0" class="discount_value discount_custom"></td>
  </tr>
</table>
</body></html>
```

- [ ] **Step 2: Commit**

```bash
git add backend/tests/fixtures/tony-order-169120.html
git commit -m "test: add Tony order HTML fixture"
```

---

## Task 3: Parse a Tony order page (positions, dates, address, budget)

**Files:**
- Create: `backend/src/services/tony-parser.js`
- Test: `backend/tests/tony-parser.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/tony-parser.test.js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTonyOrder } from '../src/services/tony-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/tony-order-169120.html'), 'utf-8');

describe('parseTonyOrder', () => {
  const parsed = parseTonyOrder(html);

  it('extracts all positions across category tables', () => {
    expect(parsed.items).toHaveLength(3);
    const names = parsed.items.map((i) => i.name);
    expect(names).toContain('Навигационные наклейки');
    expect(names).toContain('Ролл апп 85х200');
    expect(names).toContain('Монтажник');
  });

  it('captures separate price, quantity, discount, sum and category', () => {
    const banner = parsed.items.find((i) => i.name === 'Навигационные наклейки');
    expect(banner.price).toBe(2640);
    expect(banner.quantity).toBe('9');
    expect(banner.discount).toBe(0);
    expect(banner.sum).toBe(23760);
    expect(banner.category).toBe('products');

    const personnel = parsed.items.find((i) => i.name === 'Монтажник');
    expect(personnel.category).toBe('personnel');
  });

  it('parses dates including the load date/time', () => {
    expect(parsed.dates.loadDate).toBe('16.06.2026');
    expect(parsed.dates.loadTime).toBe('04:00');
    expect(parsed.dates.eventBegin).toBe('16.06.2026');
    expect(parsed.dates.eventEnd).toBe('17.06.2026');
    expect(parsed.dates.deinstallDate).toBe('17.06.2026');
    expect(parsed.dates.deinstallTime).toBe('01:00');
    expect(parsed.dates.workTimeBegin).toBe('11:00');
    expect(parsed.dates.workTimeEnd).toBe('21:00');
  });

  it('parses the address', () => {
    expect(parsed.address).toBe('г Москва, Ленинградское шоссе, д 46');
  });

  it('sums the budget from line sums', () => {
    expect(parsed.budget).toBe(23760 + 14400 + 5000);
  });

  it('returns empty result for blank html', () => {
    const empty = parseTonyOrder('');
    expect(empty.items).toEqual([]);
    expect(empty.budget).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/tony-parser.test.js`
Expected: FAIL — `parseTonyOrder` not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/tony-parser.js
import * as cheerio from 'cheerio';

const CATEGORY_TABLE_SELECTOR = 'table[data-src="order_products_list"]';

const EMPTY = {
  items: [],
  dates: {
    loadDate: '', loadTime: '', eventBegin: '', eventEnd: '',
    deinstallDate: '', deinstallTime: '', workTimeBegin: '', workTimeEnd: '',
  },
  address: '',
  budget: 0,
};

function parseNum(value) {
  if (value == null || value === '') return null;
  const normalized = String(value)
    .replace(/\u00a0/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTonyOrder(html) {
  if (!html || !String(html).trim()) {
    return { ...EMPTY, dates: { ...EMPTY.dates } };
  }

  const $ = cheerio.load(html);
  const items = [];

  $(CATEGORY_TABLE_SELECTOR).each((_, tbl) => {
    const $tbl = $(tbl);
    const category = $tbl.attr('data-var') || '';
    $tbl.find('tr[data-id]').each((__, tr) => {
      const $tr = $(tr);
      const name =
        ($tr.find('.custom_name_value').attr('value') || '').trim() ||
        $tr.find('.custom_name_title').first().text().trim();
      if (!name) return;

      const price = parseNum($tr.attr('data-price')) ?? parseNum($tr.find('.price_value').attr('value'));
      const quantity = ($tr.find('.orders_custom_edit').attr('value') || '').trim();
      const discount = parseNum($tr.find('.discount_value').attr('value')) ?? 0;
      const sum = parseNum($tr.attr('data-sum')) ?? 0;

      items.push({ name, price, quantity, discount, sum, category });
    });
  });

  const val = (name) => ($(`[name="${name}"]`).attr('value') || '').trim();

  const dates = {
    loadDate: val('date_install'),
    loadTime: val('date_install_time'),
    eventBegin: val('date_event_begin'),
    eventEnd: val('date_event_end'),
    deinstallDate: val('date_deinstall'),
    deinstallTime: val('date_deinstall_time'),
    workTimeBegin: val('work_time_begin'),
    workTimeEnd: val('work_time_end'),
  };

  const address = ($('input[name="client_address"]').attr('value') || '').trim();
  const budget = items.reduce((sum, i) => sum + (i.sum || 0), 0);

  return { items, dates, address, budget };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/tony-parser.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-parser.js backend/tests/tony-parser.test.js
git commit -m "feat: parse Tony order positions, dates, address, budget"
```

---

## Task 4: Tony config

**Files:**
- Modify: `backend/src/config.js`
- Modify: `.env.example`

- [ ] **Step 1: Add Tony config keys**

In `backend/src/config.js`, add these properties to the exported `config` object (after the `crmPassword` line):

```js
  tonyBaseUrl: process.env.TONY_BASE_URL || 'https://crm.apihide.com',
  tonyLogin: process.env.TONY_LOGIN || '',
  tonyPassword: process.env.TONY_PASSWORD || '',
  tonyRequestDelayMs: parseInt(process.env.TONY_REQUEST_DELAY_MS || '350', 10),
```

- [ ] **Step 2: Document env vars**

Append to `.env.example`:

```
# Tony (crm.apihide.com) — order source of truth
TONY_BASE_URL=https://crm.apihide.com
TONY_LOGIN=
TONY_PASSWORD=
TONY_REQUEST_DELAY_MS=350
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/config.js .env.example
git commit -m "feat: add Tony connection config"
```

---

## Task 5: Tony authentication

**Files:**
- Create: `backend/src/services/tony-auth.js`
- Test: `backend/tests/tony-auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/tony-auth.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/tony-auth.test.js`
Expected: FAIL — module/exports not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/tony-auth.js
import axios from 'axios';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

let tonyCookies = '';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

export function resetTonyAuth() {
  tonyCookies = '';
}

export function getTonyCookies() {
  return tonyCookies;
}

/** Resolve Tony connection settings: DB settings override env config. */
export function getTonyConfig() {
  return {
    baseUrl: (getSetting('tony_base_url') || config.tonyBaseUrl).replace(/\/$/, ''),
    login: getSetting('tony_login') || config.tonyLogin,
    password: getSetting('tony_password') || config.tonyPassword,
  };
}

export async function tonyLogin(options = {}) {
  const { baseUrl, login, password } = { ...getTonyConfig(), ...options };
  if (!login || !password) {
    throw new Error('Tony login failed: credentials not configured');
  }

  const resp = await axios.post(
    `${baseUrl.replace(/\/$/, '')}/ajax/login.php`,
    new URLSearchParams({ login, password }).toString(),
    {
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      validateStatus: () => true,
    }
  );

  const setCookie = resp.headers?.['set-cookie'];
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Tony login failed: no session cookie returned (check credentials)');
  }

  tonyCookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  return tonyCookies;
}

export function tonyRequestHeaders() {
  return { ...BROWSER_HEADERS, Cookie: tonyCookies };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/tony-auth.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-auth.js backend/tests/tony-auth.test.js
git commit -m "feat: add Tony login/session auth"
```

---

## Task 6: Tony order client (fetch by booking number)

**Files:**
- Create: `backend/src/services/tony-client.js`
- Test: `backend/tests/tony-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/tony-client.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/tony-client.test.js`
Expected: FAIL — `fetchTonyOrderHtml` not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/tony-client.js
import axios from 'axios';
import { getTonyConfig, tonyRequestHeaders } from './tony-auth.js';

/** Fetch a Tony order page by booking number. Returns HTML string, or null when the order does not exist (404). */
export async function fetchTonyOrderHtml(bookingNumber) {
  const { baseUrl } = getTonyConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/orders/orders_edit/?id=${encodeURIComponent(bookingNumber)}`;

  const resp = await axios.get(url, {
    headers: tonyRequestHeaders(),
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (resp.status === 404) return null;
  if (resp.status >= 400) {
    throw new Error(`Tony order ${bookingNumber} returned HTTP ${resp.status}`);
  }
  return typeof resp.data === 'string' ? resp.data : String(resp.data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/tony-client.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-client.js backend/tests/tony-client.test.js
git commit -m "feat: add Tony order fetch client"
```

---

## Task 7: Map a parsed Tony order to deal fields + content hash

**Files:**
- Create: `backend/src/services/tony-mapping.js`
- Test: `backend/tests/tony-mapping.test.js`

This converts `parseTonyOrder()` output into the columns we store on `deals`, the `deal_items` array shape consumed by `classifyItems`, and a stable content hash for change detection. Dates are converted from `DD.MM.YYYY` to ISO-ish `start_date`/`end_date` strings consistent with the calendar (`parseEventDate` accepts ISO).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/tony-mapping.test.js
import { describe, it, expect } from 'vitest';
import { buildTonyDealFields, buildTonyItems, tonyContentHash } from '../src/services/tony-mapping.js';

const parsed = {
  items: [
    { name: 'Навигационные наклейки', price: 2640, quantity: '9', discount: 0, sum: 23760, category: 'products' },
    { name: 'Монтажник', price: 5000, quantity: '1', discount: 0, sum: 5000, category: 'personnel' },
  ],
  dates: {
    loadDate: '16.06.2026', loadTime: '04:00',
    eventBegin: '16.06.2026', eventEnd: '17.06.2026',
    deinstallDate: '17.06.2026', deinstallTime: '01:00',
    workTimeBegin: '11:00', workTimeEnd: '21:00',
  },
  address: 'г Москва, Ленинградское шоссе, д 46',
  budget: 28760,
};

describe('tony-mapping', () => {
  it('maps dates and address to deal fields', () => {
    const f = buildTonyDealFields(parsed);
    expect(f.load_date).toBe('2026-06-16');
    expect(f.load_time).toBe('04:00');
    expect(f.start_date).toBe('2026-06-16T00:00:00+03:00');
    expect(f.end_date).toBe('2026-06-17T00:00:00+03:00');
    expect(f.dismantle_time).toBe('17.06.2026 01:00');
    expect(f.work_time).toBe('11:00-21:00');
    expect(f.address).toBe('г Москва, Ленинградское шоссе, д 46');
    expect(f.budget).toBe(28760);
  });

  it('builds item rows with separate price and quantity', () => {
    const items = buildTonyItems(parsed);
    expect(items[0]).toMatchObject({ name: 'Навигационные наклейки', price: 2640, quantity: '9', discount: 0 });
  });

  it('produces a stable hash that changes with content', () => {
    const h1 = tonyContentHash(parsed);
    const h2 = tonyContentHash(parsed);
    expect(h1).toBe(h2);
    const changed = { ...parsed, budget: 1 };
    expect(tonyContentHash(changed)).not.toBe(h1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/tony-mapping.test.js`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/tony-mapping.js
import crypto from 'crypto';

const DMY_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const CRM_OFFSET = '+03:00';

/** "16.06.2026" -> "2026-06-16" (or '' when not parseable). */
export function dmyToIsoDate(value) {
  const m = (value || '').trim().match(DMY_RE);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** "16.06.2026" -> "2026-06-16T00:00:00+03:00" (or '' when not parseable). */
function dmyToIsoDateTime(value) {
  const iso = dmyToIsoDate(value);
  return iso ? `${iso}T00:00:00${CRM_OFFSET}` : '';
}

export function buildTonyDealFields(parsed) {
  const d = parsed.dates;
  const dismantle = [d.deinstallDate, d.deinstallTime].filter(Boolean).join(' ').trim();
  const work = [d.workTimeBegin, d.workTimeEnd].filter(Boolean).join('-');
  return {
    load_date: dmyToIsoDate(d.loadDate),
    load_time: d.loadTime || '',
    start_date: dmyToIsoDateTime(d.eventBegin) || null,
    end_date: dmyToIsoDateTime(d.eventEnd) || null,
    arrival_time: d.loadTime || null,
    dismantle_time: dismantle || null,
    work_time: work || null,
    address: parsed.address || '',
    budget: parsed.budget || 0,
  };
}

export function buildTonyItems(parsed) {
  return parsed.items.map((i) => ({
    name: i.name,
    price: i.price,
    quantity: i.quantity,
    discount: i.discount ?? 0,
  }));
}

export function tonyContentHash(parsed) {
  const snapshot = JSON.stringify({
    items: parsed.items.map((i) => [i.name, i.price, i.quantity, i.discount, i.category]),
    dates: parsed.dates,
    address: parsed.address,
    budget: parsed.budget,
  });
  return crypto.createHash('sha256').update(snapshot).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/tony-mapping.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-mapping.js backend/tests/tony-mapping.test.js
git commit -m "feat: map Tony order to deal fields and content hash"
```

---

## Task 8: Database migration — new deal identity

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`
- Test: `backend/tests/migrate-deal-identity.test.js` (create)

The current `deals.crm_event_id` is `UNIQUE`, blocking multiple deals per event. We add `deal_key TEXT UNIQUE`, `data_source TEXT`, `load_date TEXT`, `load_time TEXT`, and rebuild the table for existing DBs that still have the `crm_event_id` unique auto-index.

- [ ] **Step 1: Update `schema.sql` for fresh installs**

In `backend/src/db/schema.sql`, change the `deals` table: replace `crm_event_id TEXT NOT NULL UNIQUE,` with `crm_event_id TEXT NOT NULL,` and add four columns after it. The top of the table becomes:

```sql
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crm_event_id TEXT NOT NULL,
  deal_key TEXT,
  data_source TEXT NOT NULL DEFAULT 'calendar',
  load_date TEXT,
  load_time TEXT,
  crm_lead_id TEXT,
```

Then, at the end of `schema.sql`, add (after the existing `INSERT OR IGNORE` settings lines):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_deal_key ON deals(deal_key);
CREATE INDEX IF NOT EXISTS idx_deals_crm_event_id ON deals(crm_event_id);

INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_base_url', 'https://crm.apihide.com');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_login', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_password', '');
```

- [ ] **Step 2: Write the failing migration test**

```js
// backend/tests/migrate-deal-identity.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateDealIdentity } from '../src/db/migrate.js';

function createLegacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      tony_order_id TEXT
    );
    INSERT INTO deals (crm_event_id, title, tony_order_id) VALUES ('evt1', 'A', '169120');
    INSERT INTO deals (crm_event_id, title, tony_order_id) VALUES ('evt2', 'B', NULL);
  `);
  return db;
}

describe('migrateDealIdentity', () => {
  let db;
  beforeEach(() => { db = createLegacyDb(); });
  afterEach(() => { db.close(); });

  it('adds new columns and backfills deal_key/data_source', () => {
    migrateDealIdentity(db);
    const rows = db.prepare('SELECT crm_event_id, deal_key, data_source FROM deals ORDER BY crm_event_id').all();
    expect(rows[0]).toMatchObject({ crm_event_id: 'evt1', deal_key: 'evt1#169120', data_source: 'tony' });
    expect(rows[1]).toMatchObject({ crm_event_id: 'evt2', deal_key: 'evt2#cal', data_source: 'calendar' });
  });

  it('drops the UNIQUE constraint on crm_event_id (allows two deals per event)', () => {
    migrateDealIdentity(db);
    db.prepare("INSERT INTO deals (crm_event_id, title, tony_order_id, deal_key, data_source) VALUES ('evt1', 'A2', '168973', 'evt1#168973', 'tony')").run();
    const count = db.prepare("SELECT COUNT(*) c FROM deals WHERE crm_event_id = 'evt1'").get().c;
    expect(count).toBe(2);
  });

  it('enforces uniqueness on deal_key', () => {
    migrateDealIdentity(db);
    expect(() =>
      db.prepare("INSERT INTO deals (crm_event_id, title, deal_key, data_source) VALUES ('evt1', 'dup', 'evt1#169120', 'tony')").run()
    ).toThrow();
  });

  it('is idempotent', () => {
    migrateDealIdentity(db);
    expect(() => migrateDealIdentity(db)).not.toThrow();
    const count = db.prepare('SELECT COUNT(*) c FROM deals').get().c;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/migrate-deal-identity.test.js`
Expected: FAIL — `migrateDealIdentity` not exported.

- [ ] **Step 4: Implement `migrateDealIdentity` and wire it into `migrate()`**

In `backend/src/db/migrate.js`, add the exported function and call it from `migrate()`. Add this function above `migrate()`:

```js
function hasUniqueIndexOnCrmEventId(db) {
  const indexes = db.prepare(`PRAGMA index_list(deals)`).all();
  for (const idx of indexes) {
    if (idx.origin === 'u') {
      const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all();
      if (cols.length === 1 && cols[0].name === 'crm_event_id') return true;
    }
  }
  return false;
}

export function migrateDealIdentity(db) {
  ensureColumn(db, 'deals', 'deal_key', 'TEXT');
  ensureColumn(db, 'deals', 'data_source', "TEXT NOT NULL DEFAULT 'calendar'");
  ensureColumn(db, 'deals', 'load_date', 'TEXT');
  ensureColumn(db, 'deals', 'load_time', 'TEXT');

  db.prepare(`
    UPDATE deals
    SET deal_key = crm_event_id || '#' || COALESCE(NULLIF(tony_order_id, ''), 'cal'),
        data_source = CASE WHEN COALESCE(NULLIF(tony_order_id, ''), '') = '' THEN 'calendar' ELSE 'tony' END
    WHERE deal_key IS NULL
  `).run();

  if (hasUniqueIndexOnCrmEventId(db)) {
    const cols = db.prepare(`PRAGMA table_info(deals)`).all().map((c) => c.name);
    const colList = cols.join(', ');
    db.exec('PRAGMA foreign_keys=OFF;');
    const tx = db.transaction(() => {
      db.exec(`ALTER TABLE deals RENAME TO deals_old;`);
      const createSql = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='deals_old'`)
        .get().sql
        .replace(/deals_old/, 'deals')
        .replace(/crm_event_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i, 'crm_event_id TEXT NOT NULL');
      db.exec(createSql);
      db.exec(`INSERT INTO deals (${colList}) SELECT ${colList} FROM deals_old;`);
      db.exec(`DROP TABLE deals_old;`);
    });
    tx();
    db.exec('PRAGMA foreign_keys=ON;');
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_deal_key ON deals(deal_key);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deals_crm_event_id ON deals(crm_event_id);`);
}
```

Then inside `migrate()`, after the existing `ensureColumn(...)` calls and before the `console.log`, add:

```js
  migrateDealIdentity(db);

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_base_url', 'https://crm.apihide.com')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_login', '')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_password', '')").run();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/migrate-deal-identity.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite to ensure no regressions**

Run: `cd backend && npm test`
Expected: PASS (all suites green).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js backend/tests/migrate-deal-identity.test.js
git commit -m "feat: migrate deals to deal_key identity for Tony multi-booking support"
```

---

## Task 9: Reconciliation — desired deal keys per event

**Files:**
- Create: `backend/src/services/tony-reconcile.js`
- Test: `backend/tests/tony-reconcile.test.js`

This module decides, for one calendar event, which `deal_key`s should exist and how existing rows transition (cal→tony relink preserving approval/twenty_id, create new, detect removed). It does NOT call Twenty — it returns a plan the parser executes.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/tony-reconcile.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { planEventReconciliation } from '../src/services/tony-reconcile.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL,
      deal_key TEXT,
      data_source TEXT NOT NULL DEFAULT 'calendar',
      tony_order_id TEXT,
      title TEXT,
      approval_status TEXT DEFAULT 'pending',
      twenty_id TEXT
    );
  `);
  return db;
}

describe('planEventReconciliation', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => { db.close(); });

  it('plans a single calendar fallback when there are no valid bookings', () => {
    const plan = planEventReconciliation(db, 'evt1', []);
    expect(plan.desired).toEqual([{ dealKey: 'evt1#cal', source: 'calendar', bookingNumber: null }]);
    expect(plan.relink).toBeNull();
    expect(plan.removeDealIds).toEqual([]);
  });

  it('plans one tony deal per valid booking number', () => {
    const plan = planEventReconciliation(db, 'evt1', ['169120', '168973']);
    expect(plan.desired).toEqual([
      { dealKey: 'evt1#169120', source: 'tony', bookingNumber: '169120' },
      { dealKey: 'evt1#168973', source: 'tony', bookingNumber: '168973' },
    ]);
  });

  it('relinks an existing single calendar deal to a single new booking (preserving the row)', () => {
    const id = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, approval_status, twenty_id) VALUES ('evt1', 'evt1#cal', 'calendar', 'approved', 'opp-1') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120']);
    expect(plan.relink).toEqual({ dealId: id, newDealKey: 'evt1#169120', bookingNumber: '169120' });
    expect(plan.removeDealIds).toEqual([]);
  });

  it('marks deals for removal when their booking disappears', () => {
    db.prepare("INSERT INTO deals (crm_event_id, deal_key, data_source, tony_order_id, twenty_id) VALUES ('evt1', 'evt1#169120', 'tony', '169120', 'opp-1')").run();
    const goneId = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, tony_order_id, twenty_id) VALUES ('evt1', 'evt1#168973', 'tony', '168973', 'opp-2') RETURNING id"
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120']);
    expect(plan.removeDealIds).toEqual([goneId]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/tony-reconcile.test.js`
Expected: FAIL — `planEventReconciliation` not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/tony-reconcile.js

/** Compute the desired set of deal keys for an event given its valid booking numbers. */
export function desiredDealKeys(crmEventId, validBookingNumbers) {
  if (!validBookingNumbers || validBookingNumbers.length === 0) {
    return [{ dealKey: `${crmEventId}#cal`, source: 'calendar', bookingNumber: null }];
  }
  return validBookingNumbers.map((n) => ({
    dealKey: `${crmEventId}#${n}`,
    source: 'tony',
    bookingNumber: n,
  }));
}

/**
 * Plan reconciliation for one event:
 * - desired: target deal keys
 * - relink: { dealId, newDealKey, bookingNumber } when an existing single `#cal` deal
 *   should be converted in place to a single new tony booking (preserves approval/overrides/twenty_id)
 * - removeDealIds: existing deal ids whose key is no longer desired (to be cancelled)
 */
export function planEventReconciliation(db, crmEventId, validBookingNumbers) {
  const desired = desiredDealKeys(crmEventId, validBookingNumbers);
  const desiredKeys = new Set(desired.map((d) => d.dealKey));

  const existing = db
    .prepare('SELECT id, deal_key, data_source FROM deals WHERE crm_event_id = ?')
    .all(crmEventId);

  let relink = null;
  const existingCal = existing.filter((d) => d.deal_key === `${crmEventId}#cal`);
  if (
    existingCal.length === 1 &&
    existing.length === 1 &&
    desired.length === 1 &&
    desired[0].source === 'tony'
  ) {
    relink = {
      dealId: existingCal[0].id,
      newDealKey: desired[0].dealKey,
      bookingNumber: desired[0].bookingNumber,
    };
  }

  const relinkedId = relink ? relink.dealId : null;
  const removeDealIds = existing
    .filter((d) => !desiredKeys.has(d.deal_key) && d.id !== relinkedId)
    .map((d) => d.id);

  return { desired, relink, removeDealIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/tony-reconcile.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-reconcile.js backend/tests/tony-reconcile.test.js
git commit -m "feat: plan per-event deal reconciliation for Tony sources"
```

---

## Task 10: Twenty opportunity — load date + price×quantity amount

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Test: `backend/tests/twenty-opportunity.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/twenty-opportunity.test.js
import { describe, it, expect } from 'vitest';
import { buildOpportunityInput, parseQuantity } from '../src/services/twenty-opportunity.js';

describe('buildOpportunityInput', () => {
  it('computes amount from price * quantity of items', () => {
    const deal = { title: 'T', crm_event_id: 'e1', start_date: '2026-06-16T00:00:00+03:00' };
    const items = [
      { price: 2640, quantity: '9' },
      { price: 5000, quantity: '1' },
    ];
    const input = buildOpportunityInput(deal, items);
    expect(input.amount.amountMicros).toBe((2640 * 9 + 5000) * 1_000_000);
  });

  it('includes loadDate when deal has load_date', () => {
    const deal = { title: 'T', crm_event_id: 'e1', load_date: '2026-06-16', load_time: '04:00' };
    const input = buildOpportunityInput(deal, []);
    expect(input.loadDate).toBe('2026-06-16T04:00:00+03:00');
  });

  it('omits loadDate when no load_date', () => {
    const input = buildOpportunityInput({ title: 'T', crm_event_id: 'e1' }, []);
    expect(input.loadDate).toBeUndefined();
  });
});

describe('parseQuantity', () => {
  it('parses numeric strings, defaults to 1 for non-numeric', () => {
    expect(parseQuantity('9')).toBe(9);
    expect(parseQuantity('∞')).toBe(1);
    expect(parseQuantity(null)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/twenty-opportunity.test.js`
Expected: FAIL — `parseQuantity` not exported; `loadDate`/amount behavior missing.

- [ ] **Step 3: Modify `twenty-opportunity.js`**

Add a `parseQuantity` export and update `buildOpportunityInput`. Replace the `brandingBudget` line and add loadDate handling:

```js
export function parseQuantity(value) {
  const n = Number.parseInt(String(value ?? '').replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
```

Change the amount calculation inside `buildOpportunityInput` from:

```js
  const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0), 0);
```

to:

```js
  const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0) * parseQuantity(i.quantity), 0);
```

Add load date mapping. After the existing `if (deal.dismantle_time) ...` block and before `return input;`, add:

```js
  if (deal.load_date) {
    const time = /^\d{1,2}:\d{2}$/.test(deal.load_time || '') ? deal.load_time : '00:00';
    input.loadDate = `${deal.load_date}T${time.padStart(5, '0')}:00+03:00`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/twenty-opportunity.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite**

Run: `cd backend && npm test`
Expected: PASS. (If `twenty-sync.test.js` asserts the old amount formula with quantities present, update those expectations to `price * quantity`.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/tests/twenty-opportunity.test.js
git commit -m "feat: Twenty amount uses price*quantity and syncs load date"
```

---

## Task 11: Create the "Дата загрузки" custom field in Twenty (manual prerequisite)

**Files:** none (operational step against the Twenty workspace).

`input.loadDate` (Task 10) requires a matching field on the Opportunity object in Twenty, named `loadDate` (type DATE_TIME). The existing `tonyLink`, `arrivalTime`, etc. are custom fields, so this follows the same pattern.

- [ ] **Step 1: Create the field**

In the Twenty admin UI (or via the metadata API used for other custom fields), on the **Opportunity** object create a custom field:
- API name: `loadDate`
- Label: `Дата загрузки`
- Type: `DATE_TIME`

- [ ] **Step 2: Verify**

After Task 13 runs a parse against a Tony-linked deal, confirm in Twenty that the opportunity shows "Дата загрузки". If the GraphQL mutation rejects `loadDate` as unknown, the field name/type does not match — fix the field before proceeding.

(No commit — operational step.)

---

## Task 12: Orchestrate source selection + reconciliation in the parser

**Files:**
- Modify: `backend/src/services/parser.js`

This wires everything together. The calendar discovery (`fetchEvents`) and the per-event description fetch are unchanged. The new logic: per event, resolve booking numbers, fetch valid Tony orders, plan reconciliation, then upsert each desired deal from its source (Tony or calendar fallback).

- [ ] **Step 1: Add imports at the top of `parser.js`**

After the existing imports, add:

```js
import { extractBookingNumbers } from './booking-numbers.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchTonyOrderHtml } from './tony-client.js';
import { parseTonyOrder } from './tony-parser.js';
import { buildTonyDealFields, buildTonyItems, tonyContentHash } from './tony-mapping.js';
import { planEventReconciliation } from './tony-reconcile.js';
import { config } from '../config.js';
```

(If `config` is already imported, do not duplicate it.)

- [ ] **Step 2: Establish a Tony session once per run (graceful degradation)**

Inside `runParsing`, right after `await authenticate();`, add:

```js
    let tonyReady = false;
    const tonyCfg = getTonyConfig();
    if (tonyCfg.login && tonyCfg.password) {
      try {
        await tonyLogin();
        tonyReady = true;
      } catch (err) {
        console.warn(`[tony] login failed, falling back to calendar for this run: ${err.message}`);
      }
    }
```

- [ ] **Step 3: Add a helper to fetch + validate Tony orders for an event**

Add this function near the top of `parser.js` (module scope, after `getSetting`):

```js
async function resolveTonyOrders(tonyReady, bookingNumbers) {
  const orders = new Map(); // bookingNumber -> parsed order
  if (!tonyReady) return orders;
  for (const n of bookingNumbers) {
    await delay(config.tonyRequestDelayMs);
    try {
      const html = await fetchTonyOrderHtml(n);
      if (html) orders.set(n, parseTonyOrder(html));
    } catch (err) {
      console.error(`[tony] failed to fetch order ${n}: ${err.message}`);
    }
  }
  return orders;
}
```

- [ ] **Step 4: Replace the per-event persistence block with source-aware reconciliation**

Within the `for (const event of events) { ... }` loop in `runParsing`, after `descHtml` is obtained and the `existing` lookup currently runs, replace the existing single-deal create/update logic with the following. The full loop body (from extracting `eventId` to the end of one iteration) becomes:

```js
      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      await delay(350);

      let descJson;
      try {
        descJson = await fetchDescription(eventId);
      } catch (err) {
        console.error(`Failed to fetch description for event ${eventId}:`, err.message);
        continue;
      }

      const descHtml = typeof descJson === 'string'
        ? JSON.parse(descJson).description
        : descJson.description;
      if (!descHtml) continue;

      const titleInfo = parseDealTitle(event.title || '', knownCodes);
      const bookingNumbers = extractBookingNumbers(event.title || '');
      const tonyOrders = await resolveTonyOrders(tonyReady, bookingNumbers);
      const validBookings = bookingNumbers.filter((n) => tonyOrders.has(n));

      const plan = planEventReconciliation(db, eventId, validBookings);

      // Relink a single calendar deal to a single new booking, preserving the row.
      if (plan.relink) {
        db.prepare('UPDATE deals SET deal_key = ?, data_source = ?, tony_order_id = ? WHERE id = ?')
          .run(plan.relink.newDealKey, 'tony', plan.relink.bookingNumber, plan.relink.dealId);
      }

      for (const target of plan.desired) {
        const existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(target.dealKey);

        if (target.source === 'tony') {
          const order = tonyOrders.get(target.bookingNumber);
          const hash = tonyContentHash(order);
          if (existing && existing.content_hash === hash) { skippedDeals++; continue; }

          const fields = buildTonyDealFields(order);
          const classifiedItems = await classifyItems(buildTonyItems(order), keywords, llmPrompt);

          if (existing) {
            const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;
            db.prepare(`
              UPDATE deals SET
                title = ?, company_code = ?, manager_name = ?,
                start_date = ?, end_date = ?, department = ?,
                contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
                address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
                load_date = ?, load_time = ?, budget = ?,
                content_hash = ?, data_source = 'tony', tony_order_id = ?, crm_lead_id = ?,
                twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END,
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
              event.title, titleInfo.companyCode, titleInfo.managerName,
              fields.start_date, fields.end_date, event.department,
              parseDealDescription(descHtml).contact.name, parseDealDescription(descHtml).contact.email,
              parseDealDescription(descHtml).contact.company, parseDealDescription(descHtml).contact.phone,
              fields.address, fields.work_time, fields.arrival_time, fields.dismantle_time,
              fields.load_date, fields.load_time, fields.budget,
              hash, target.bookingNumber, event.leadid,
              wasCancelled ? 1 : 0, existing.id
            );
            const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
            replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
            if (existing.twenty_id) dealsToResync.push(existing.id);
            updatedDeals++;
          } else {
            const contact = parseDealDescription(descHtml).contact;
            const insert = db.prepare(`
              INSERT INTO deals (
                crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
                start_date, end_date, department, contact_name, contact_email, contact_company, contact_phone,
                address, work_time, arrival_time, dismantle_time, load_date, load_time, budget,
                tony_order_id, content_hash, raw_description
              ) VALUES (?, ?, 'tony', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              eventId, target.dealKey, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
              fields.start_date, fields.end_date, event.department, contact.name, contact.email, contact.company, contact.phone,
              fields.address, fields.work_time, fields.arrival_time, fields.dismantle_time, fields.load_date, fields.load_time, fields.budget,
              target.bookingNumber, hash, descHtml
            );
            const dealId = insert.lastInsertRowid;
            for (const item of classifiedItems) {
              db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
            }
            newDeals++;
          }
        } else {
          // calendar fallback — existing behavior, keyed by deal_key
          const hash = contentHash(descHtml);
          if (existing && existing.content_hash === hash) { skippedDeals++; continue; }

          const parsed = parseDealDescription(descHtml);
          const classifiedItems = await classifyItems(parsed.items, keywords, llmPrompt);

          if (existing) {
            const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;
            db.prepare(`
              UPDATE deals SET
                title = ?, company_code = ?, manager_name = ?, start_date = ?, end_date = ?, department = ?,
                status = ?, legal_entity = ?, invoice_number = ?, budget = ?, discount = ?,
                contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
                address = ?, venue_type = ?, arrival_time = ?, ready_time = ?, work_time = ?, dismantle_time = ?,
                content_hash = ?, raw_description = ?, crm_lead_id = ?, data_source = 'calendar',
                twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END, updated_at = datetime('now')
              WHERE id = ?
            `).run(
              event.title, titleInfo.companyCode, titleInfo.managerName, event.start, event.end, event.department,
              parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber, parsed.meta.budget, parsed.meta.discount,
              parsed.contact.name, parsed.contact.email, parsed.contact.company, parsed.contact.phone,
              parsed.event.address, parsed.event.venueType, parsed.event.arrivalTime || null, parsed.event.readyTime || null,
              parsed.event.workTime || null, parsed.event.dismantleTime || null,
              hash, descHtml, event.leadid, wasCancelled ? 1 : 0, existing.id
            );
            const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
            replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
            if (existing.twenty_id) dealsToResync.push(existing.id);
            updatedDeals++;
          } else {
            const insert = db.prepare(`
              INSERT INTO deals (
                crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
                start_date, end_date, department, status, legal_entity, invoice_number, budget, discount,
                contact_name, contact_email, contact_company, contact_phone, address, venue_type,
                arrival_time, ready_time, work_time, dismantle_time, content_hash, raw_description
              ) VALUES (?, ?, 'calendar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              eventId, target.dealKey, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
              event.start, event.end, event.department, parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber,
              parsed.meta.budget, parsed.meta.discount, parsed.contact.name, parsed.contact.email, parsed.contact.company, parsed.contact.phone,
              parsed.event.address, parsed.event.venueType, parsed.event.arrivalTime || null, parsed.event.readyTime || null,
              parsed.event.workTime || null, parsed.event.dismantleTime || null, hash, descHtml
            );
            const dealId = insert.lastInsertRowid;
            for (const item of classifiedItems) {
              db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
            }
            newDeals++;
          }
        }
      }

      // Cancel deals whose booking disappeared (only when Tony was reachable, to avoid mass-cancel on outage).
      if (tonyReady) {
        for (const removeId of plan.removeDealIds) {
          const row = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(removeId);
          if (row && row.twenty_id) {
            try { await cancelDealInTwenty(removeId); cancelledDeals++; } catch (err) {
              console.error(`[tony] cancel failed for deal ${removeId}: ${err.message}`);
            }
          }
        }
      }
```

Notes for the implementer:
- Declare `let cancelledDeals = 0;` near the other counters at the top of the try block if it is not already in scope there (the original code declares it later near the missing-deals section; move that declaration up so it covers both usages, and remove the later duplicate `let cancelledDeals = 0;`).
- Keep the existing calendar-missing cancellation block at the end of `runParsing` unchanged; it still cancels deals for events that vanished entirely. With multiple deals per event it operates per-row via `twenty_id`, which remains correct.
- The repeated `parseDealDescription(descHtml)` calls in the Tony branch fetch contacts from the calendar (contacts stay calendar-sourced per spec). For clarity the implementer may hoist `const calContact = parseDealDescription(descHtml).contact;` once per iteration and reuse it.

- [ ] **Step 5: Run the full test suite**

Run: `cd backend && npm test`
Expected: PASS. Fix any breakage in `twenty-sync`/`deals-sort` tests caused by the new columns (they should be unaffected, but verify).

- [ ] **Step 6: Manual smoke test (local, no prod)**

Set `TONY_LOGIN`/`TONY_PASSWORD`/`TONY_BASE_URL` in a local `.env`, run the app locally (`docker-compose up` or `npm start`), trigger a parse over a small date range that includes a known booking (e.g. 169120), and verify:
- a deal is created with `data_source = 'tony'`, populated `load_date`, and items with separate price/quantity;
- a title with no booking number yields a `#cal` deal;
- a title with two bookings yields two deals.

Run (DB inspection example):

```bash
cd backend && node -e "import('./src/db/connection.js').then(async m => { const db = m.getDb(); console.log(db.prepare('SELECT deal_key, data_source, tony_order_id, load_date FROM deals LIMIT 20').all()); })"
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/parser.js
git commit -m "feat: parse orders from Tony with calendar fallback and reconciliation"
```

---

## Task 13: Tony credentials in Settings UI

**Files:**
- Modify: `backend/src/routes/settings.js`
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Allow saving Tony settings keys via the settings route**

Inspect `backend/src/routes/settings.js` to find the allow-list of editable setting keys (the existing code restricts which keys can be written). Add `tony_base_url`, `tony_login`, `tony_password` to that allow-list. If the route writes any provided key without an allow-list, no change is needed here — verify before editing.

- [ ] **Step 2: Add Tony fields to the Settings page**

In `frontend/src/pages/Settings.jsx`, add a "Tony (crm.apihide.com)" section with three controlled inputs bound to settings `tony_base_url` (text), `tony_login` (text), `tony_password` (password), following the existing pattern used for CRM credentials in that file (same state/handlers/save call). Mirror the existing field markup exactly so styling and the save flow are consistent.

- [ ] **Step 3: Verify locally**

Run the app, open Settings, enter Tony credentials, save, reload — confirm values persist (password may render blank by design; confirm the saved value is used by a parse).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/settings.js frontend/src/pages/Settings.jsx
git commit -m "feat: manage Tony credentials in settings UI"
```

---

## Task 14: Full regression + final verification

- [ ] **Step 1: Run the entire backend suite**

Run: `cd backend && npm test`
Expected: PASS — all suites including the new Tony tests.

- [ ] **Step 2: Build the frontend (no type/build errors)**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit any lockfile/build artifacts if changed**

```bash
git add -A
git commit -m "chore: regression pass for Tony order source feature"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Calendar = discovery only, Tony = source of truth → Tasks 6, 12.
- No booking number → calendar fallback; later re-link on next parse → Tasks 9 (relink), 12.
- Multiple booking numbers → separate deals → Tasks 8 (deal_key), 9, 12.
- Positions with separate price/quantity, all categories → Tasks 3, 7, 10.
- Load date (`date_install`) → Tasks 3, 7, 10 (Twenty), 11 (field).
- Event/dismount dates, address, budget from Tony → Tasks 3, 7, 12.
- Contacts/legal/invoice stay from calendar → Task 12 (Tony branch reads `parseDealDescription` contact; legal/invoice only set on calendar branch, intentionally not overwritten for Tony deals).
- Two independent auth providers → Task 5 (Tony) leaves `auth.js` untouched.
- Tony outage → no mass cancel, calendar fallback → Task 12 Step 2 (`tonyReady`), Step 4 (cancel guarded by `tonyReady`).
- Tests mirroring `backend/tests/` → Tasks 1, 3, 5, 6, 7, 8, 9, 10.

**Placeholder scan:** No TBD/TODO; every code step contains full code. Tasks 11 and 13 contain operational/UI steps that reference existing in-repo patterns rather than inventing unknown markup — acceptable because the exact Settings markup must match existing code in the repo.

**Type/name consistency:** `extractBookingNumbers`, `parseTonyOrder` (`{items, dates, address, budget}`), `buildTonyDealFields`/`buildTonyItems`/`tonyContentHash`, `tonyLogin`/`getTonyConfig`/`tonyRequestHeaders`/`getTonyCookies`/`resetTonyAuth`, `fetchTonyOrderHtml`, `planEventReconciliation`/`desiredDealKeys`, `parseQuantity` — names are used consistently across tasks. Date field names (`load_date`, `load_time`, `start_date`, `end_date`, `dismantle_time`, `work_time`, `address`, `budget`) match between `tony-mapping` and the parser persistence in Task 12.
