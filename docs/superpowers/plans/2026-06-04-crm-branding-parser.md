# CRM Branding Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React webapp that parses deals from an internal CRM calendar, classifies branding-related items (keywords + LLM), and syncs approved deals to Twenty CRM.

**Architecture:** Node.js/Express backend handles CRM authentication (auto-login + cookie-fallback), parses deals via AJAX endpoints, classifies items, and syncs to Twenty CRM via GraphQL. React/Vite frontend provides dashboard, deal approval queue, settings, and logs. SQLite for persistence. Docker image built via GitHub Actions → GHCR.

**Tech Stack:** Node.js 20, Express, better-sqlite3, node-cron, cheerio, axios; React 18, Vite, Tailwind CSS, TanStack Query, React Router.

**Spec:** `docs/superpowers/specs/2026-06-04-crm-branding-parser-design.md`

---

## File Structure

```
crmparserv2/
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.js                  # Express app entry point
│   │   ├── config.js                 # Environment config
│   │   ├── db/
│   │   │   ├── connection.js         # SQLite connection singleton
│   │   │   ├── migrate.js            # Schema migration runner
│   │   │   └── schema.sql            # DDL for all tables
│   │   ├── services/
│   │   │   ├── auth.js               # CRM auth (login + cookie-fallback + token)
│   │   │   ├── parser.js             # Fetch events + descriptions from CRM
│   │   │   ├── html-parser.js        # Parse deal HTML → structured data
│   │   │   ├── title-parser.js       # Parse deal title → company + manager
│   │   │   ├── classifier.js         # Keyword + LLM classification
│   │   │   ├── twenty-sync.js        # Twenty CRM GraphQL sync
│   │   │   └── scheduler.js          # Cron job management
│   │   ├── routes/
│   │   │   ├── deals.js              # GET/PATCH deals, approval actions
│   │   │   ├── parsing.js            # POST trigger parse, GET parse runs
│   │   │   ├── settings.js           # GET/PUT settings, keywords, companies
│   │   │   └── logs.js               # GET logs
│   │   └── middleware/
│   │       └── error-handler.js      # Global error handler
│   └── tests/
│       ├── html-parser.test.js
│       ├── title-parser.test.js
│       ├── classifier.test.js
│       └── fixtures/
│           └── deal-description.html # Sample deal HTML for tests
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx                   # Router + layout
│   │   ├── api.js                    # Axios instance + TanStack Query hooks
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Deals.jsx
│   │   │   ├── Settings.jsx
│   │   │   └── Logs.jsx
│   │   ├── components/
│   │   │   ├── Layout.jsx            # Sidebar + content area
│   │   │   ├── DealRow.jsx           # Expandable deal row
│   │   │   ├── DealItems.jsx         # Items table inside expanded row
│   │   │   ├── StatusBadge.jsx       # Colored status badge
│   │   │   └── StatCard.jsx          # Dashboard stat card
│   │   └── index.css                 # Tailwind imports
├── Dockerfile
├── docker-compose.yml
├── .github/
│   └── workflows/
│       └── docker-publish.yml
├── .env.example
├── .gitignore
└── .dockerignore
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/config.js`
- Create: `backend/src/index.js`
- Create: `backend/src/middleware/error-handler.js`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
data/
*.db
.env
```

- [ ] **Step 2: Create `.env.example`**

```env
CRM_BASE_URL=https://apihide.com/bitrix/calendar/
CRM_LOGIN=
CRM_PASSWORD=

LLM_API_URL=
LLM_API_KEY=
LLM_MODEL=

TWENTY_API_URL=
TWENTY_API_TOKEN=

SESSION_SECRET=change-me
PORT=3000
```

- [ ] **Step 3: Initialize backend `package.json`**

Run:
```bash
cd backend
npm init -y
npm install express better-sqlite3 axios cheerio node-cron crypto dotenv
npm install -D vitest
```

- [ ] **Step 4: Create `backend/src/config.js`**

```js
import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  crmBaseUrl: process.env.CRM_BASE_URL || 'https://apihide.com/bitrix/calendar/',
  crmLogin: process.env.CRM_LOGIN || '',
  crmPassword: process.env.CRM_PASSWORD || '',
  llmApiUrl: process.env.LLM_API_URL || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || '',
  twentyApiUrl: process.env.TWENTY_API_URL || '',
  twentyApiToken: process.env.TWENTY_API_TOKEN || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  dbPath: process.env.DB_PATH || './data/crmparser.db',
};
```

- [ ] **Step 5: Create `backend/src/middleware/error-handler.js`**

```js
export function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${err.stack || err.message}`);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
}
```

- [ ] **Step 6: Create `backend/src/index.js`**

```js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { initDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import dealsRouter from './routes/deals.js';
import parsingRouter from './routes/parsing.js';
import settingsRouter from './routes/settings.js';
import logsRouter from './routes/logs.js';
import { initScheduler } from './services/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

app.use('/api/deals', dealsRouter);
app.use('/api/parsing', parsingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);

app.use(express.static(path.join(__dirname, '../public')));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function start() {
  initDb();
  migrate();
  initScheduler();
  app.listen(config.port, () => {
    console.log(`CRM Parser running on port ${config.port}`);
  });
}

start();

export default app;
```

Add `"type": "module"` and a `"start"` script to `backend/package.json`:
```json
{
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: project scaffold with backend entry point and config"
```

---

## Task 2: Database Schema and Connection

**Files:**
- Create: `backend/src/db/schema.sql`
- Create: `backend/src/db/connection.js`
- Create: `backend/src/db/migrate.js`

- [ ] **Step 1: Create `backend/src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crm_event_id TEXT NOT NULL UNIQUE,
  crm_lead_id TEXT,
  title TEXT NOT NULL,
  company_code TEXT,
  manager_name TEXT,
  start_date TEXT,
  end_date TEXT,
  department TEXT,
  status TEXT,
  legal_entity TEXT,
  invoice_number TEXT,
  budget TEXT,
  discount TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_company TEXT,
  contact_phone TEXT,
  address TEXT,
  venue_type TEXT,
  content_hash TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  twenty_id TEXT,
  synced_at TEXT,
  raw_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL,
  quantity TEXT,
  discount REAL,
  classification TEXT NOT NULL DEFAULT 'unclassified',
  classification_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parse_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  total_events INTEGER DEFAULT 0,
  new_deals INTEGER DEFAULT 0,
  updated_deals INTEGER DEFAULT 0,
  skipped_deals INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  twenty_id TEXT
);

CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id),
  twenty_id TEXT,
  UNIQUE(name, company_id)
);

INSERT OR IGNORE INTO companies (code, full_name) VALUES ('ПРО', 'ProInteractive');
INSERT OR IGNORE INTO companies (code, full_name) VALUES ('АРТ', 'Art-Active');
INSERT OR IGNORE INTO companies (code, full_name) VALUES ('АРЕНДА', 'Arenda');

INSERT OR IGNORE INTO settings (key, value) VALUES ('approval_mode', 'manual');
INSERT OR IGNORE INTO settings (key, value) VALUES ('parse_schedule', '0 18 * * *');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_mode', 'auto');
INSERT OR IGNORE INTO settings (key, value) VALUES ('keywords', '["брендинг","баннер","печать","плёнка","пленка","наклейка","логотип","вывеска","табличка","ролл-ап","rollup","стенд","press-wall","пресс-волл"]');
INSERT OR IGNORE INTO settings (key, value) VALUES ('crm_cookies', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_prompt', 'Ты помощник отдела брендинга. Определи, относится ли позиция к брендингу (печать, баннеры, наклейки, вывески, оформление и т.д.). Ответь JSON: {"items": [{"name": "...", "is_branding": true/false, "confidence": 0.0-1.0}]}');
```

- [ ] **Step 2: Create `backend/src/db/connection.js`**

```js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let db;

export function initDb() {
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
```

- [ ] **Step 3: Create `backend/src/db/migrate.js`**

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function migrate() {
  const db = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  console.log('Database migrated successfully');
}
```

- [ ] **Step 4: Verify DB initializes correctly**

Run:
```bash
cd backend
node -e "import('./src/db/connection.js').then(m => { m.initDb(); import('./src/db/migrate.js').then(m2 => { m2.migrate(); console.log('OK') }) })"
```
Expected: `Database migrated successfully` and `OK`, file `data/crmparser.db` created.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: database schema and migration for deals, items, settings"
```

---

## Task 3: Deal Title Parser

**Files:**
- Create: `backend/src/services/title-parser.js`
- Create: `backend/tests/title-parser.test.js`

- [ ] **Step 1: Write tests for title parser**

Create `backend/tests/title-parser.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseDealTitle } from '../src/services/title-parser.js';

describe('parseDealTitle', () => {
  it('extracts company and manager from standard format', () => {
    const result = parseDealTitle(
      'ПРО/29.05-05.06./КАПЫ/ЛУЖНИКИ/В МОМЕНТЕ/167015 /ДОЗАБОР+ПРОДЛЕНИЕ/168973/Шунькин'
    );
    expect(result.companyCode).toBe('ПРО');
    expect(result.managerName).toBe('Шунькин');
  });

  it('handles АРТ company', () => {
    const result = parseDealTitle('АРТ/10.06/ВЫСТАВКА/Иванов');
    expect(result.companyCode).toBe('АРТ');
    expect(result.managerName).toBe('Иванов');
  });

  it('handles АРЕНДА company', () => {
    const result = parseDealTitle('АРЕНДА/15.06-20.06/ПАРК/Петрова');
    expect(result.companyCode).toBe('АРЕНДА');
    expect(result.managerName).toBe('Петрова');
  });

  it('handles title with only two segments', () => {
    const result = parseDealTitle('ПРО/Сидоров');
    expect(result.companyCode).toBe('ПРО');
    expect(result.managerName).toBe('Сидоров');
  });

  it('handles title with no slashes', () => {
    const result = parseDealTitle('Неформатированная сделка');
    expect(result.companyCode).toBe(null);
    expect(result.managerName).toBe(null);
    expect(result.parseError).toBe(true);
  });

  it('trims whitespace from segments', () => {
    const result = parseDealTitle(' ПРО / 29.05 / Шунькин ');
    expect(result.companyCode).toBe('ПРО');
    expect(result.managerName).toBe('Шунькин');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/title-parser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement title parser**

Create `backend/src/services/title-parser.js`:

```js
const KNOWN_COMPANIES = ['ПРО', 'АРТ', 'АРЕНДА'];

export function parseDealTitle(title) {
  if (!title || !title.includes('/')) {
    return { companyCode: null, managerName: null, parseError: true, rawTitle: title };
  }

  const segments = title.split('/').map(s => s.trim()).filter(Boolean);

  if (segments.length < 2) {
    return { companyCode: null, managerName: null, parseError: true, rawTitle: title };
  }

  const companyCode = segments[0];
  const managerName = segments[segments.length - 1];

  const isKnownCompany = KNOWN_COMPANIES.includes(companyCode);

  return {
    companyCode: isKnownCompany ? companyCode : companyCode,
    managerName,
    parseError: !isKnownCompany,
    rawTitle: title,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/title-parser.test.js`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: deal title parser with company/manager extraction"
```

---

## Task 4: HTML Description Parser

**Files:**
- Create: `backend/tests/fixtures/deal-description.html`
- Create: `backend/src/services/html-parser.js`
- Create: `backend/tests/html-parser.test.js`

- [ ] **Step 1: Create test fixture**

Create `backend/tests/fixtures/deal-description.html` with the real sample HTML from the spec (the deal description the user provided). Copy this content:

```html
<p><b>-</b>
_____________________________________________

Статус сделки: Мероприятие проведено

Юр. Лицо: ИП Ухловский
№ cчета: 913

Скидка: %
Бюджет: 1 087 408.04 руб.
_____________________________________________

Контактное лицо: Чернов Михаил
E-Mail: mchernov@iconagency.ru
Название бренда: 
Компания: ПРОМО ПОЛЕ
Контактный телефон: 

Адрес проведения: Краснодарский край, г Сочи
Самовывоз: 
Время приезда: 00:00
Готовность: 08:00
Время работы: 08:00 - 20:00
Время демонтажа: 00:00
Контакт на площадке: -
Количество гостей: 
Место проведения: Улица
Этаж: -
Дресс-код для персонала: -
На что крепим оборудование: Без креплений
Обменяться документами: Нет
Забрать деньги на заказе: 0 руб.
Наименование оборудования: </p><table class="table-caption">
                                <tbody><tr>
                                    <th>Название</th>
                                    <th>Итого (руб.)</th>
                                    <th>Кол-во</th>
                                    <th>Сумма скидки</th>
                                </tr>
                                <tr>
									<td>Шатер Кайт 4х4</td>
									<td>146 448.00</td>
									<td class="text-center">4 шт.</td>
									<td class="text-center">0.00</td>
									</tr><tr>
									<td>Брендинг стены</td>
									<td>161 364.00</td>
									<td class="text-center">2 шт.</td>
									<td class="text-center">0.00</td>
									</tr><tr>
									<td>Монтаж стенок (баннера)</td>
									<td>82 716.00</td>
									<td class="text-center">1 шт.</td>
									<td class="text-center">0.00</td>
									</tr></tbody></table>
Парковка: -
Будет субаренда?: Нет
```

- [ ] **Step 2: Write tests for HTML parser**

Create `backend/tests/html-parser.test.js`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDealDescription } from '../src/services/html-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures/deal-description.html'),
  'utf-8'
);

describe('parseDealDescription', () => {
  const result = parseDealDescription(fixtureHtml);

  it('extracts deal status', () => {
    expect(result.meta.status).toBe('Мероприятие проведено');
  });

  it('extracts legal entity', () => {
    expect(result.meta.legalEntity).toBe('ИП Ухловский');
  });

  it('extracts invoice number', () => {
    expect(result.meta.invoiceNumber).toBe('913');
  });

  it('extracts budget', () => {
    expect(result.meta.budget).toBe('1 087 408.04 руб.');
  });

  it('extracts contact name', () => {
    expect(result.contact.name).toBe('Чернов Михаил');
  });

  it('extracts contact email', () => {
    expect(result.contact.email).toBe('mchernov@iconagency.ru');
  });

  it('extracts contact company', () => {
    expect(result.contact.company).toBe('ПРОМО ПОЛЕ');
  });

  it('extracts address', () => {
    expect(result.event.address).toBe('Краснодарский край, г Сочи');
  });

  it('extracts items from table', () => {
    expect(result.items).toHaveLength(3);
  });

  it('extracts item name and price', () => {
    const branding = result.items.find(i => i.name === 'Брендинг стены');
    expect(branding).toBeDefined();
    expect(branding.price).toBeCloseTo(161364.00);
    expect(branding.quantity).toBe('2 шт.');
  });

  it('handles empty HTML gracefully', () => {
    const empty = parseDealDescription('');
    expect(empty.items).toEqual([]);
    expect(empty.meta.status).toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/html-parser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement HTML parser**

Create `backend/src/services/html-parser.js`:

```js
import * as cheerio from 'cheerio';

function extractField(text, label) {
  const regex = new RegExp(`${label}:\\s*(.+?)(?:\\n|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  const cleaned = priceStr.replace(/\s/g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

export function parseDealDescription(html) {
  if (!html) {
    return {
      meta: { status: '', legalEntity: '', invoiceNumber: '', budget: '', discount: '' },
      contact: { name: '', email: '', company: '', phone: '' },
      event: { address: '', venueType: '' },
      items: [],
    };
  }

  const $ = cheerio.load(html);
  const text = $.text();

  const meta = {
    status: extractField(text, 'Статус сделки'),
    legalEntity: extractField(text, 'Юр\\. Лицо'),
    invoiceNumber: extractField(text, '№ cчета'),
    budget: extractField(text, 'Бюджет'),
    discount: extractField(text, 'Скидка'),
  };

  const contact = {
    name: extractField(text, 'Контактное лицо'),
    email: extractField(text, 'E-Mail'),
    company: extractField(text, 'Компания'),
    phone: extractField(text, 'Контактный телефон'),
  };

  const event = {
    address: extractField(text, 'Адрес проведения'),
    venueType: extractField(text, 'Место проведения'),
  };

  const items = [];
  $('table.table-caption tr').each((i, row) => {
    if (i === 0) return; // skip header
    const cells = $(row).find('td');
    if (cells.length >= 3) {
      items.push({
        name: $(cells[0]).text().trim(),
        price: parsePrice($(cells[1]).text().trim()),
        quantity: $(cells[2]).text().trim(),
        discount: parsePrice($(cells[3])?.text()?.trim()),
      });
    }
  });

  return { meta, contact, event, items };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/html-parser.test.js`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: HTML description parser for deal metadata and items table"
```

---

## Task 5: Classifier Service

**Files:**
- Create: `backend/src/services/classifier.js`
- Create: `backend/tests/classifier.test.js`

- [ ] **Step 1: Write tests for keyword classifier**

Create `backend/tests/classifier.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { classifyByKeywords } from '../src/services/classifier.js';

const keywords = ['брендинг', 'баннер', 'печать', 'наклейка', 'логотип'];

describe('classifyByKeywords', () => {
  it('matches exact keyword in item name', () => {
    const result = classifyByKeywords(
      [{ name: 'Брендинг стены', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('keyword_match');
  });

  it('matches partial keyword (баннер in баннера)', () => {
    const result = classifyByKeywords(
      [{ name: 'Монтаж стенок (баннера)', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('keyword_match');
  });

  it('marks non-matching items as unclassified', () => {
    const result = classifyByKeywords(
      [{ name: 'Шатер Кайт 4х4', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('unclassified');
  });

  it('is case-insensitive', () => {
    const result = classifyByKeywords(
      [{ name: 'ПЕЧАТЬ на баннере', price: 100 }],
      keywords
    );
    expect(result[0].classification).toBe('keyword_match');
  });

  it('processes multiple items', () => {
    const items = [
      { name: 'Брендинг стены', price: 100 },
      { name: 'Шатер Кайт 4х4', price: 200 },
      { name: 'Наклейка на стенд', price: 50 },
    ];
    const result = classifyByKeywords(items, keywords);
    expect(result[0].classification).toBe('keyword_match');
    expect(result[1].classification).toBe('unclassified');
    expect(result[2].classification).toBe('keyword_match');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/classifier.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement classifier**

Create `backend/src/services/classifier.js`:

```js
import axios from 'axios';
import { config } from '../config.js';

export function classifyByKeywords(items, keywords) {
  return items.map(item => {
    const nameLower = item.name.toLowerCase();
    const matched = keywords.some(kw => nameLower.includes(kw.toLowerCase()));
    return {
      ...item,
      classification: matched ? 'keyword_match' : 'unclassified',
      classification_confidence: matched ? 1.0 : null,
    };
  });
}

export async function classifyByLlm(items, prompt) {
  if (!config.llmApiUrl || !config.llmApiKey) {
    return items.map(item => ({ ...item }));
  }

  const itemNames = items.map(i => i.name).join('\n- ');
  const userMessage = `Определи, какие из этих позиций относятся к брендингу:\n- ${itemNames}`;

  try {
    const response = await axios.post(
      config.llmApiUrl,
      {
        model: config.llmModel,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Authorization': `Bearer ${config.llmApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const content = response.data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    return items.map(item => {
      const llmItem = parsed.items?.find(
        li => li.name.toLowerCase() === item.name.toLowerCase()
      );
      if (!llmItem) return item;
      return {
        ...item,
        classification: llmItem.is_branding ? 'llm_confirmed' : 'llm_rejected',
        classification_confidence: llmItem.confidence ?? null,
      };
    });
  } catch (err) {
    console.error('LLM classification failed:', err.message);
    return items.map(item => ({ ...item }));
  }
}

export async function classifyItems(items, keywords, llmPrompt) {
  const afterKeywords = classifyByKeywords(items, keywords);
  const unclassified = afterKeywords.filter(i => i.classification === 'unclassified');

  if (unclassified.length === 0 || !config.llmApiUrl) {
    return afterKeywords;
  }

  const llmResults = await classifyByLlm(unclassified, llmPrompt);

  return afterKeywords.map(item => {
    if (item.classification !== 'unclassified') return item;
    const llmResult = llmResults.find(
      li => li.name === item.name
    );
    return llmResult || item;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/classifier.test.js`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: keyword + LLM classifier for deal items"
```

---

## Task 6: Auth Service

**Files:**
- Create: `backend/src/services/auth.js`

- [ ] **Step 1: Implement auth service**

Create `backend/src/services/auth.js`:

```js
import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

let sessionCookies = '';
let calToken = '';
let keepAliveTimer = null;

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

function getAuthMode() {
  return getSetting('auth_mode') || 'auto';
}

function getCrmCookies() {
  return getSetting('crm_cookies');
}

function buildUrl(path) {
  const base = config.crmBaseUrl.replace(/\/$/, '');
  return `${base}/${path}`;
}

async function loginWithCredentials() {
  const loginUrl = buildUrl('dashboard.php');

  const loginResp = await axios.post(loginUrl, new URLSearchParams({
    login: config.crmLogin,
    password: config.crmPassword,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 5,
    validateStatus: () => true,
    withCredentials: true,
  });

  const setCookieHeaders = loginResp.headers['set-cookie'];
  if (setCookieHeaders) {
    sessionCookies = setCookieHeaders
      .map(c => c.split(';')[0])
      .join('; ');
  }

  return sessionCookies;
}

async function extractToken() {
  const dashboardUrl = buildUrl('dashboard.php');
  const resp = await axios.get(dashboardUrl, {
    headers: { Cookie: sessionCookies },
    validateStatus: () => true,
  });

  const $ = cheerio.load(resp.data);
  calToken = $('#cal_token').val() || '';

  if (!calToken) {
    throw new Error('Failed to extract cal_token from dashboard');
  }

  return calToken;
}

function startKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(async () => {
    try {
      await axios.get(buildUrl('keep.php'), {
        headers: { Cookie: sessionCookies },
      });
    } catch (err) {
      console.error('Keep-alive failed:', err.message);
    }
  }, 5 * 60 * 1000);
}

export async function authenticate() {
  const mode = getAuthMode();

  if (mode === 'cookies') {
    sessionCookies = getCrmCookies();
    if (!sessionCookies) {
      throw new Error('Cookie mode selected but no cookies configured');
    }
  } else {
    let attempts = 0;
    let lastError;
    while (attempts < 3) {
      try {
        await loginWithCredentials();
        break;
      } catch (err) {
        lastError = err;
        attempts++;
        if (attempts < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (attempts >= 3) {
      console.error('Auto-login failed 3 times, switching to cookie fallback');
      const db = getDb();
      db.prepare("UPDATE settings SET value = 'cookies' WHERE key = 'auth_mode'").run();
      sessionCookies = getCrmCookies();
      if (!sessionCookies) {
        throw new Error(`Auto-login failed (${lastError?.message}) and no fallback cookies available`);
      }
    }
  }

  await extractToken();
  startKeepAlive();

  return { cookies: sessionCookies, token: calToken };
}

export function getSessionCookies() {
  return sessionCookies;
}

export function getCalToken() {
  return calToken;
}

export function setManualCookies(cookies) {
  sessionCookies = cookies;
}

export function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: CRM auth service with auto-login and cookie fallback"
```

---

## Task 7: Parser Service

**Files:**
- Create: `backend/src/services/parser.js`

- [ ] **Step 1: Implement parser service**

Create `backend/src/services/parser.js`:

```js
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { authenticate, getSessionCookies, getCalToken } from './auth.js';
import { parseDealDescription } from './html-parser.js';
import { parseDealTitle } from './title-parser.js';
import { classifyItems } from './classifier.js';

function buildUrl(path) {
  const base = config.crmBaseUrl.replace(/\/$/, '');
  return `${base}/${path}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function contentHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function fetchEvents(startUnix, endUnix) {
  const token = getCalToken();
  const cookies = getSessionCookies();
  const url = buildUrl(`includes/cal_events.php?token=${token}&start=${startUnix}&end=${endUnix}`);

  const resp = await axios.get(url, {
    headers: { Cookie: cookies },
    timeout: 30000,
  });

  return resp.data;
}

async function fetchDescription(eventId) {
  const cookies = getSessionCookies();
  const url = buildUrl('includes/cal_description.php');

  const resp = await axios.post(url, new URLSearchParams({
    id: eventId,
    mode: 'edit',
  }).toString(), {
    headers: {
      Cookie: cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 30000,
  });

  return resp.data;
}

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

export async function runParsing(startDate, endDate) {
  const db = getDb();

  const run = db.prepare(
    'INSERT INTO parse_runs (status) VALUES (?)'
  ).run('running');
  const runId = run.lastInsertRowid;

  try {
    await authenticate();

    const startUnix = Math.floor(new Date(startDate).getTime() / 1000);
    const endUnix = Math.floor(new Date(endDate).getTime() / 1000);

    const events = await fetchEvents(startUnix, endUnix);

    if (!Array.isArray(events)) {
      throw new Error('CRM returned non-array response for events');
    }

    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const llmPrompt = getSetting('llm_prompt') || '';

    let newDeals = 0;
    let updatedDeals = 0;
    let skippedDeals = 0;

    for (const event of events) {
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

      const hash = contentHash(descHtml);

      const existing = db.prepare(
        'SELECT id, content_hash FROM deals WHERE crm_event_id = ?'
      ).get(eventId);

      if (existing && existing.content_hash === hash) {
        skippedDeals++;
        continue;
      }

      const parsed = parseDealDescription(descHtml);
      const titleInfo = parseDealTitle(event.title || '');

      const classifiedItems = await classifyItems(parsed.items, keywords, llmPrompt);

      if (existing) {
        db.prepare(`
          UPDATE deals SET
            title = ?, company_code = ?, manager_name = ?,
            start_date = ?, end_date = ?, department = ?,
            status = ?, legal_entity = ?, invoice_number = ?,
            budget = ?, discount = ?, contact_name = ?,
            contact_email = ?, contact_company = ?, contact_phone = ?,
            address = ?, venue_type = ?, content_hash = ?,
            raw_description = ?, crm_lead_id = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, event.department,
          parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber,
          parsed.meta.budget, parsed.meta.discount, parsed.contact.name,
          parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType, hash,
          descHtml, event.leadid,
          existing.id
        );

        db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(existing.id);

        for (const item of classifiedItems) {
          db.prepare(`
            INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(existing.id, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }

        updatedDeals++;
      } else {
        const insert = db.prepare(`
          INSERT INTO deals (
            crm_event_id, crm_lead_id, title, company_code, manager_name,
            start_date, end_date, department, status, legal_entity,
            invoice_number, budget, discount, contact_name, contact_email,
            contact_company, contact_phone, address, venue_type,
            content_hash, raw_description
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, event.department, parsed.meta.status, parsed.meta.legalEntity,
          parsed.meta.invoiceNumber, parsed.meta.budget, parsed.meta.discount, parsed.contact.name,
          parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType, hash, descHtml
        );

        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`
            INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }

        newDeals++;
      }
    }

    db.prepare(`
      UPDATE parse_runs SET
        finished_at = datetime('now'), status = 'completed',
        total_events = ?, new_deals = ?, updated_deals = ?, skipped_deals = ?
      WHERE id = ?
    `).run(events.length, newDeals, updatedDeals, skippedDeals, runId);

    return { runId, total: events.length, newDeals, updatedDeals, skippedDeals };
  } catch (err) {
    db.prepare(`
      UPDATE parse_runs SET finished_at = datetime('now'), status = 'failed', error = ? WHERE id = ?
    `).run(err.message, runId);
    throw err;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: parser service — fetch events, descriptions, store deals"
```

---

## Task 8: Twenty CRM Sync Service

**Files:**
- Create: `backend/src/services/twenty-sync.js`

- [ ] **Step 1: Implement Twenty sync service**

Create `backend/src/services/twenty-sync.js`:

```js
import axios from 'axios';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

function gql(query, variables = {}) {
  return axios.post(
    config.twentyApiUrl,
    { query, variables },
    {
      headers: {
        'Authorization': `Bearer ${config.twentyApiToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
}

async function findOrCreateCompany(code) {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE code = ?').get(code);
  if (!company) return null;

  if (company.twenty_id) return company.twenty_id;

  const searchResp = await gql(`
    query { companies(filter: { name: { eq: "${company.full_name}" } }) { edges { node { id } } } }
  `);

  const existing = searchResp.data?.data?.companies?.edges?.[0]?.node;
  if (existing) {
    db.prepare('UPDATE companies SET twenty_id = ? WHERE id = ?').run(existing.id, company.id);
    return existing.id;
  }

  const createResp = await gql(`
    mutation($input: CompanyCreateInput!) { createCompany(data: $input) { id } }
  `, { input: { name: company.full_name } });

  const newId = createResp.data?.data?.createCompany?.id;
  if (newId) {
    db.prepare('UPDATE companies SET twenty_id = ? WHERE id = ?').run(newId, company.id);
  }
  return newId;
}

async function findOrCreatePerson(managerName, companyTwentyId) {
  const db = getDb();

  const manager = db.prepare(
    'SELECT * FROM managers WHERE name = ?'
  ).get(managerName);

  if (manager?.twenty_id) return manager.twenty_id;

  const searchResp = await gql(`
    query { people(filter: { name: { lastName: { eq: "${managerName}" } } }) { edges { node { id } } } }
  `);

  const existing = searchResp.data?.data?.people?.edges?.[0]?.node;
  if (existing) {
    if (manager) {
      db.prepare('UPDATE managers SET twenty_id = ? WHERE id = ?').run(existing.id, manager.id);
    } else {
      db.prepare('INSERT INTO managers (name, twenty_id) VALUES (?, ?)').run(managerName, existing.id);
    }
    return existing.id;
  }

  const input = {
    name: { lastName: managerName, firstName: '' },
  };
  if (companyTwentyId) input.companyId = companyTwentyId;

  const createResp = await gql(`
    mutation($input: PersonCreateInput!) { createPerson(data: $input) { id } }
  `, { input });

  const newId = createResp.data?.data?.createPerson?.id;
  if (newId) {
    if (manager) {
      db.prepare('UPDATE managers SET twenty_id = ? WHERE id = ?').run(newId, manager.id);
    } else {
      db.prepare('INSERT INTO managers (name, twenty_id) VALUES (?, ?)').run(managerName, newId);
    }
  }
  return newId;
}

export async function syncDealToTwenty(dealId) {
  if (!config.twentyApiUrl || !config.twentyApiToken) {
    throw new Error('Twenty CRM not configured');
  }

  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  if (deal.twenty_id) return { twentyId: deal.twenty_id, action: 'already_synced' };

  const items = db.prepare(
    "SELECT * FROM deal_items WHERE deal_id = ? AND classification IN ('keyword_match', 'llm_confirmed')"
  ).all(dealId);

  const companyTwentyId = deal.company_code
    ? await findOrCreateCompany(deal.company_code)
    : null;

  const personTwentyId = deal.manager_name
    ? await findOrCreatePerson(deal.manager_name, companyTwentyId)
    : null;

  const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0), 0);

  const oppInput = {
    name: deal.title || `Deal ${deal.crm_event_id}`,
    stage: 'NEW',
    closeDate: deal.end_date || deal.start_date || new Date().toISOString(),
    amount: { amountMicros: Math.round(brandingBudget * 1000000), currencyCode: 'RUB' },
  };
  if (companyTwentyId) oppInput.companyId = companyTwentyId;
  if (personTwentyId) oppInput.pointOfContactId = personTwentyId;

  const oppResp = await gql(`
    mutation($input: OpportunityCreateInput!) { createOpportunity(data: $input) { id } }
  `, { input: oppInput });

  const oppId = oppResp.data?.data?.createOpportunity?.id;
  if (!oppId) throw new Error('Failed to create opportunity in Twenty');

  if (items.length > 0) {
    const itemsText = items
      .map(i => `• ${i.name} — ${i.price?.toLocaleString('ru-RU')} руб. × ${i.quantity}`)
      .join('\n');

    await gql(`
      mutation($input: NoteCreateInput!) { createNote(data: $input) { id } }
    `, {
      input: {
        title: 'Позиции брендинга',
        body: itemsText,
        activityTargets: [{ opportunityId: oppId }],
      },
    });
  }

  db.prepare(
    "UPDATE deals SET twenty_id = ?, synced_at = datetime('now'), approval_status = 'synced' WHERE id = ?"
  ).run(oppId, dealId);

  return { twentyId: oppId, action: 'created' };
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: Twenty CRM sync — companies, persons, opportunities"
```

---

## Task 9: API Routes

**Files:**
- Create: `backend/src/routes/deals.js`
- Create: `backend/src/routes/parsing.js`
- Create: `backend/src/routes/settings.js`
- Create: `backend/src/routes/logs.js`

- [ ] **Step 1: Create deals routes**

Create `backend/src/routes/deals.js`:

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { syncDealToTwenty } from '../services/twenty-sync.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { status, company, from, to, limit = 50, offset = 0 } = req.query;

  let where = '1=1';
  const params = [];

  if (status) { where += ' AND d.approval_status = ?'; params.push(status); }
  if (company) { where += ' AND d.company_code = ?'; params.push(company); }
  if (from) { where += ' AND d.start_date >= ?'; params.push(from); }
  if (to) { where += ' AND d.start_date <= ?'; params.push(to); }

  const deals = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM deal_items WHERE deal_id = d.id AND classification IN ('keyword_match','llm_confirmed')) as branding_count,
      (SELECT COUNT(*) FROM deal_items WHERE deal_id = d.id) as total_items
    FROM deals d WHERE ${where}
    ORDER BY d.start_date DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM deals d WHERE ${where}`).get(...params);

  res.json({ deals, total: total.count });
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM deals').get().c,
    pending: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'pending'").get().c,
    approved: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'approved'").get().c,
    synced: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'synced'").get().c,
    rejected: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'rejected'").get().c,
  };
  res.json(stats);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(req.params.id);
  res.json({ ...deal, items });
});

router.patch('/:id/approve', async (req, res, next) => {
  try {
    const db = getDb();
    db.prepare("UPDATE deals SET approval_status = 'approved', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    const result = await syncDealToTwenty(Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.patch('/:id/reject', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE deals SET approval_status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

router.post('/bulk-approve', async (req, res, next) => {
  try {
    const { ids } = req.body;
    const results = [];
    for (const id of ids) {
      const db = getDb();
      db.prepare("UPDATE deals SET approval_status = 'approved', updated_at = datetime('now') WHERE id = ?").run(id);
      try {
        const result = await syncDealToTwenty(id);
        results.push({ id, ...result });
      } catch (err) {
        results.push({ id, error: err.message });
      }
    }
    res.json({ results });
  } catch (err) { next(err); }
});

router.post('/bulk-reject', (req, res) => {
  const { ids } = req.body;
  const db = getDb();
  const stmt = db.prepare("UPDATE deals SET approval_status = 'rejected', updated_at = datetime('now') WHERE id = ?");
  for (const id of ids) stmt.run(id);
  res.json({ success: true });
});

router.patch('/:dealId/items/:itemId', (req, res) => {
  const { classification } = req.body;
  const db = getDb();
  db.prepare('UPDATE deal_items SET classification = ? WHERE id = ? AND deal_id = ?')
    .run(classification, req.params.itemId, req.params.dealId);
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Create parsing routes**

Create `backend/src/routes/parsing.js`:

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { runParsing } from '../services/parser.js';

const router = Router();

let parsingInProgress = false;

router.post('/run', async (req, res, next) => {
  if (parsingInProgress) {
    return res.status(409).json({ error: 'Parsing already in progress' });
  }

  try {
    parsingInProgress = true;
    const { startDate, endDate } = req.body;

    const now = new Date();
    const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = endDate || new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

    const result = await runParsing(start, end);
    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    parsingInProgress = false;
  }
});

router.get('/status', (req, res) => {
  res.json({ inProgress: parsingInProgress });
});

router.get('/runs', (req, res) => {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM parse_runs ORDER BY started_at DESC LIMIT 50').all();
  res.json(runs);
});

export default router;
```

- [ ] **Step 3: Create settings routes**

Create `backend/src/routes/settings.js`:

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

router.put('/:key', (req, res) => {
  const { value } = req.body;
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(req.params.key, value);
  res.json({ success: true });
});

router.get('/keywords', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'keywords'").get();
  res.json(JSON.parse(row?.value || '[]'));
});

router.put('/keywords', (req, res) => {
  const { keywords } = req.body;
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('keywords', ?)").run(JSON.stringify(keywords));
  res.json({ success: true });
});

router.get('/companies', (req, res) => {
  const db = getDb();
  const companies = db.prepare('SELECT * FROM companies ORDER BY code').all();
  res.json(companies);
});

router.put('/companies/:id', (req, res) => {
  const { code, full_name } = req.body;
  const db = getDb();
  db.prepare('UPDATE companies SET code = ?, full_name = ? WHERE id = ?').run(code, full_name, req.params.id);
  res.json({ success: true });
});

router.post('/companies', (req, res) => {
  const { code, full_name } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO companies (code, full_name) VALUES (?, ?)').run(code, full_name);
  res.json({ id: result.lastInsertRowid });
});

export default router;
```

- [ ] **Step 4: Create logs routes**

Create `backend/src/routes/logs.js`:

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { limit = 100, offset = 0 } = req.query;
  const runs = db.prepare(
    'SELECT * FROM parse_runs ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM parse_runs').get();
  res.json({ logs: runs, total: total.count });
});

export default router;
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: API routes for deals, parsing, settings, and logs"
```

---

## Task 10: Scheduler

**Files:**
- Create: `backend/src/services/scheduler.js`

- [ ] **Step 1: Implement scheduler**

Create `backend/src/services/scheduler.js`:

```js
import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { runParsing } from './parser.js';
import { syncDealToTwenty } from './twenty-sync.js';

let scheduledTask = null;

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

async function scheduledParse() {
  console.log(`[${new Date().toISOString()}] Scheduled parsing started`);
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

    await runParsing(start, end);

    const approvalMode = getSetting('approval_mode');
    if (approvalMode === 'auto' || approvalMode === 'semi') {
      const db = getDb();
      let query = "SELECT d.id FROM deals d WHERE d.approval_status = 'pending'";

      if (approvalMode === 'semi') {
        query += " AND EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.classification = 'keyword_match')";
      }

      const dealsToSync = db.prepare(query).all();
      for (const deal of dealsToSync) {
        try {
          await syncDealToTwenty(deal.id);
        } catch (err) {
          console.error(`Auto-sync failed for deal ${deal.id}:`, err.message);
        }
      }
    }

    console.log(`[${new Date().toISOString()}] Scheduled parsing completed`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Scheduled parsing failed:`, err.message);
  }
}

export function initScheduler() {
  const schedule = getSetting('parse_schedule') || '0 18 * * *';

  if (scheduledTask) {
    scheduledTask.stop();
  }

  if (cron.validate(schedule)) {
    scheduledTask = cron.schedule(schedule, scheduledParse);
    console.log(`Scheduler initialized with cron: ${schedule}`);
  } else {
    console.error(`Invalid cron expression: ${schedule}`);
  }
}

export function restartScheduler() {
  initScheduler();
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: cron scheduler with auto/semi-auto approval modes"
```

---

## Task 11: Frontend Scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/vite.config.js`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/App.jsx`
- Create: `frontend/src/api.js`

- [ ] **Step 1: Initialize frontend**

Run:
```bash
cd frontend
npm init -y
npm install react react-dom react-router-dom @tanstack/react-query axios
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite postcss
```

- [ ] **Step 2: Create `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 3: Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CRM Branding Parser</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 4: Create `frontend/src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 5: Create `frontend/src/api.js`**

```js
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const api = axios.create({ baseURL: '/api' });

export function useDeals(params = {}) {
  return useQuery({
    queryKey: ['deals', params],
    queryFn: () => api.get('/deals', { params }).then(r => r.data),
  });
}

export function useDealStats() {
  return useQuery({
    queryKey: ['deal-stats'],
    queryFn: () => api.get('/deals/stats').then(r => r.data),
  });
}

export function useDeal(id) {
  return useQuery({
    queryKey: ['deal', id],
    queryFn: () => api.get(`/deals/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

export function useApproveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.patch(`/deals/${id}/approve`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useRejectDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.patch(`/deals/${id}/reject`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post('/deals/bulk-approve', { ids }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useBulkReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post('/deals/bulk-reject', { ids }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useRunParsing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/parsing/run', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
      qc.invalidateQueries({ queryKey: ['parse-runs'] });
    },
  });
}

export function useParsingStatus() {
  return useQuery({
    queryKey: ['parsing-status'],
    queryFn: () => api.get('/parsing/status').then(r => r.data),
    refetchInterval: 5000,
  });
}

export function useParseRuns() {
  return useQuery({
    queryKey: ['parse-runs'],
    queryFn: () => api.get('/parsing/runs').then(r => r.data),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => api.put(`/settings/${key}`, { value }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useKeywords() {
  return useQuery({
    queryKey: ['keywords'],
    queryFn: () => api.get('/settings/keywords').then(r => r.data),
  });
}

export function useUpdateKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keywords) => api.put('/settings/keywords', { keywords }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keywords'] }),
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/settings/companies').then(r => r.data),
  });
}

export function useLogs(params = {}) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => api.get('/logs', { params }).then(r => r.data),
  });
}

export function useUpdateItemClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId, classification }) =>
      api.patch(`/deals/${dealId}/items/${itemId}`, { classification }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}
```

- [ ] **Step 6: Create `frontend/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 7: Create `frontend/src/App.jsx`**

```jsx
import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Settings from './pages/Settings';
import Logs from './pages/Logs';

const navItems = [
  { to: '/', label: 'Дашборд', icon: '◻' },
  { to: '/deals', label: 'Сделки', icon: '◻' },
  { to: '/settings', label: 'Настройки', icon: '◻' },
  { to: '/logs', label: 'Логи', icon: '◻' },
];

export default function App() {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-800">CRM Parser</h1>
          <p className="text-xs text-gray-500">Отдел брендинга</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </main>
    </div>
  );
}
```

Add scripts to `frontend/package.json`:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: frontend scaffold — React, Vite, Tailwind, routing, API hooks"
```

---

## Task 12: Frontend Pages — Dashboard

**Files:**
- Create: `frontend/src/pages/Dashboard.jsx`
- Create: `frontend/src/components/StatCard.jsx`

- [ ] **Step 1: Create StatCard component**

Create `frontend/src/components/StatCard.jsx`:

```jsx
export default function StatCard({ label, value, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
  };

  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Create Dashboard page**

Create `frontend/src/pages/Dashboard.jsx`:

```jsx
import { useDealStats, useRunParsing, useParsingStatus, useParseRuns } from '../api';
import StatCard from '../components/StatCard';

export default function Dashboard() {
  const { data: stats } = useDealStats();
  const { data: parsingStatus } = useParsingStatus();
  const { data: runs } = useParseRuns();
  const parsing = useRunParsing();

  const lastRun = runs?.[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Дашборд</h2>
        <button
          onClick={() => parsing.mutate({})}
          disabled={parsing.isPending || parsingStatus?.inProgress}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parsing.isPending || parsingStatus?.inProgress ? 'Парсинг...' : 'Запустить парсинг'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Всего сделок" value={stats?.total ?? '—'} color="gray" />
        <StatCard label="Ожидают апрува" value={stats?.pending ?? '—'} color="yellow" />
        <StatCard label="Одобрено" value={stats?.approved ?? '—'} color="blue" />
        <StatCard label="Синхронизировано" value={stats?.synced ?? '—'} color="green" />
        <StatCard label="Отклонено" value={stats?.rejected ?? '—'} color="red" />
      </div>

      {lastRun && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Последний парсинг</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Время: </span>
              <span>{new Date(lastRun.started_at).toLocaleString('ru-RU')}</span>
            </div>
            <div>
              <span className="text-gray-500">Статус: </span>
              <span className={lastRun.status === 'completed' ? 'text-green-600' : 'text-red-600'}>
                {lastRun.status}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Событий: </span>
              <span>{lastRun.total_events}</span>
            </div>
            <div>
              <span className="text-gray-500">Новых: </span>
              <span>{lastRun.new_deals}</span>
            </div>
          </div>
          {lastRun.error && (
            <p className="mt-2 text-sm text-red-600">{lastRun.error}</p>
          )}
        </div>
      )}

      {parsing.isError && (
        <p className="mt-4 text-sm text-red-600">Ошибка: {parsing.error.message}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: dashboard page with stats and manual parse trigger"
```

---

## Task 13: Frontend Pages — Deals

**Files:**
- Create: `frontend/src/pages/Deals.jsx`
- Create: `frontend/src/components/DealRow.jsx`
- Create: `frontend/src/components/DealItems.jsx`
- Create: `frontend/src/components/StatusBadge.jsx`

- [ ] **Step 1: Create StatusBadge**

Create `frontend/src/components/StatusBadge.jsx`:

```jsx
const statusConfig = {
  pending: { label: 'Ожидает', className: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Одобрено', className: 'bg-blue-100 text-blue-800' },
  synced: { label: 'Синхр.', className: 'bg-green-100 text-green-800' },
  rejected: { label: 'Отклонено', className: 'bg-red-100 text-red-800' },
};

export default function StatusBadge({ status }) {
  const cfg = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
```

- [ ] **Step 2: Create DealItems**

Create `frontend/src/components/DealItems.jsx`:

```jsx
const classColors = {
  keyword_match: 'bg-green-50 border-l-4 border-green-400',
  llm_confirmed: 'bg-blue-50 border-l-4 border-blue-400',
  llm_rejected: 'bg-gray-50',
  unclassified: 'bg-gray-50',
};

const classLabels = {
  keyword_match: 'Ключевое слово',
  llm_confirmed: 'LLM: да',
  llm_rejected: 'LLM: нет',
  unclassified: 'Не определено',
};

export default function DealItems({ items }) {
  if (!items?.length) return <p className="text-sm text-gray-500 p-3">Нет позиций</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 text-xs uppercase">
          <th className="p-2">Название</th>
          <th className="p-2">Цена</th>
          <th className="p-2">Кол-во</th>
          <th className="p-2">Классификация</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} className={classColors[item.classification] || ''}>
            <td className="p-2 font-medium">{item.name}</td>
            <td className="p-2">{item.price?.toLocaleString('ru-RU')} ₽</td>
            <td className="p-2">{item.quantity}</td>
            <td className="p-2">
              <span className="text-xs">{classLabels[item.classification] || item.classification}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create DealRow**

Create `frontend/src/components/DealRow.jsx`:

```jsx
import { useState } from 'react';
import { useDeal, useApproveDeal, useRejectDeal } from '../api';
import StatusBadge from './StatusBadge';
import DealItems from './DealItems';

export default function DealRow({ deal, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const { data: details } = useDeal(expanded ? deal.id : null);
  const approve = useApproveDeal();
  const reject = useRejectDeal();

  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(deal.id)}
            className="rounded"
          />
        </td>
        <td className="p-3 text-sm">{deal.start_date?.slice(0, 10)}</td>
        <td className="p-3 text-sm font-medium max-w-xs truncate">{deal.title}</td>
        <td className="p-3 text-sm">{deal.company_code}</td>
        <td className="p-3 text-sm">{deal.manager_name}</td>
        <td className="p-3 text-sm">{deal.branding_count}/{deal.total_items}</td>
        <td className="p-3 text-sm">{deal.budget}</td>
        <td className="p-3"><StatusBadge status={deal.approval_status} /></td>
        <td className="p-3" onClick={e => e.stopPropagation()}>
          {deal.approval_status === 'pending' && (
            <div className="flex gap-1">
              <button
                onClick={() => approve.mutate(deal.id)}
                disabled={approve.isPending}
                className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
              >
                ✓
              </button>
              <button
                onClick={() => reject.mutate(deal.id)}
                disabled={reject.isPending}
                className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
              >
                ✗
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-gray-50 p-0">
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                <div><span className="text-gray-500">Контакт:</span> {details?.contact_name}</div>
                <div><span className="text-gray-500">Email:</span> {details?.contact_email}</div>
                <div><span className="text-gray-500">Компания:</span> {details?.contact_company}</div>
                <div><span className="text-gray-500">Адрес:</span> {details?.address}</div>
              </div>
              <DealItems items={details?.items} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 4: Create Deals page**

Create `frontend/src/pages/Deals.jsx`:

```jsx
import { useState } from 'react';
import { useDeals, useBulkApprove, useBulkReject } from '../api';
import DealRow from '../components/DealRow';

export default function Deals() {
  const [filters, setFilters] = useState({ status: '', company: '' });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { data, isLoading } = useDeals(filters);
  const bulkApprove = useBulkApprove();
  const bulkReject = useBulkReject();

  const deals = data?.deals || [];

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === deals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deals.map(d => d.id)));
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Сделки</h2>

      <div className="flex gap-3 mb-4 items-center">
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="pending">Ожидают</option>
          <option value="approved">Одобрено</option>
          <option value="synced">Синхронизировано</option>
          <option value="rejected">Отклонено</option>
        </select>
        <select
          value={filters.company}
          onChange={e => setFilters(f => ({ ...f, company: e.target.value }))}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">Все компании</option>
          <option value="ПРО">ПРО</option>
          <option value="АРТ">АРТ</option>
          <option value="АРЕНДА">АРЕНДА</option>
        </select>

        {selectedIds.size > 0 && (
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => { bulkApprove.mutate([...selectedIds]); setSelectedIds(new Set()); }}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
            >
              Одобрить ({selectedIds.size})
            </button>
            <button
              onClick={() => { bulkReject.mutate([...selectedIds]); setSelectedIds(new Set()); }}
              className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
            >
              Отклонить ({selectedIds.size})
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Загрузка...</p>
        ) : deals.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Нет сделок</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="p-3">
                  <input type="checkbox" onChange={toggleAll} checked={selectedIds.size === deals.length && deals.length > 0} className="rounded" />
                </th>
                <th className="p-3">Дата</th>
                <th className="p-3">Название</th>
                <th className="p-3">Компания</th>
                <th className="p-3">Менеджер</th>
                <th className="p-3">Брендинг</th>
                <th className="p-3">Бюджет</th>
                <th className="p-3">Статус</th>
                <th className="p-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {deals.map(deal => (
                <DealRow
                  key={deal.id}
                  deal={deal}
                  selected={selectedIds.has(deal.id)}
                  onSelect={toggleSelect}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: deals page with expandable rows, approval, and bulk actions"
```

---

## Task 14: Frontend Pages — Settings & Logs

**Files:**
- Create: `frontend/src/pages/Settings.jsx`
- Create: `frontend/src/pages/Logs.jsx`

- [ ] **Step 1: Create Settings page**

Create `frontend/src/pages/Settings.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { useSettings, useUpdateSetting, useKeywords, useUpdateKeywords, useCompanies } from '../api';

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function Settings() {
  const { data: settings } = useSettings();
  const { data: keywords } = useKeywords();
  const { data: companies } = useCompanies();
  const updateSetting = useUpdateSetting();
  const updateKeywords = useUpdateKeywords();

  const [newKeyword, setNewKeyword] = useState('');
  const [cookieValue, setCookieValue] = useState('');

  useEffect(() => {
    if (settings?.crm_cookies) setCookieValue(settings.crm_cookies);
  }, [settings?.crm_cookies]);

  function addKeyword() {
    if (!newKeyword.trim()) return;
    const updated = [...(keywords || []), newKeyword.trim()];
    updateKeywords.mutate(updated);
    setNewKeyword('');
  }

  function removeKeyword(kw) {
    updateKeywords.mutate((keywords || []).filter(k => k !== kw));
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Настройки</h2>

      <Section title="Авторизация CRM">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Режим авторизации</label>
            <select
              value={settings?.auth_mode || 'auto'}
              onChange={e => updateSetting.mutate({ key: 'auth_mode', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full max-w-xs"
            >
              <option value="auto">Автоматический (login/password)</option>
              <option value="cookies">Cookie fallback</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Cookies (для fallback-режима)</label>
            <textarea
              value={cookieValue}
              onChange={e => setCookieValue(e.target.value)}
              onBlur={() => updateSetting.mutate({ key: 'crm_cookies', value: cookieValue })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full h-20 font-mono"
              placeholder="Вставьте cookies из DevTools..."
            />
          </div>
        </div>
      </Section>

      <Section title="Ключевые слова брендинга">
        <div className="flex flex-wrap gap-2 mb-3">
          {(keywords || []).map(kw => (
            <span key={kw} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-md text-sm">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="text-blue-400 hover:text-red-500">&times;</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addKeyword()}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 max-w-xs"
            placeholder="Новое ключевое слово..."
          />
          <button onClick={addKeyword} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700">
            Добавить
          </button>
        </div>
      </Section>

      <Section title="Расписание парсинга">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Cron-выражение</label>
            <input
              defaultValue={settings?.parse_schedule || '0 18 * * *'}
              onBlur={e => updateSetting.mutate({ key: 'parse_schedule', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full max-w-xs font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">По умолчанию: 0 18 * * * (каждый день в 18:00)</p>
          </div>
        </div>
      </Section>

      <Section title="Режим апрува">
        <select
          value={settings?.approval_mode || 'manual'}
          onChange={e => updateSetting.mutate({ key: 'approval_mode', value: e.target.value })}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full max-w-xs"
        >
          <option value="manual">Ручной — все сделки в очередь</option>
          <option value="semi">Полуавтоматический — keyword_match автоматически</option>
          <option value="auto">Автоапрув — всё автоматически</option>
        </select>
      </Section>

      <Section title="LLM">
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm text-gray-600 mb-1">API URL</label>
            <input
              defaultValue={settings?.llm_api_url || ''}
              onBlur={e => updateSetting.mutate({ key: 'llm_api_url', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
              placeholder="https://api.openai.com/v1/chat/completions"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">API Key</label>
            <input
              type="password"
              defaultValue={settings?.llm_api_key || ''}
              onBlur={e => updateSetting.mutate({ key: 'llm_api_key', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Модель</label>
            <input
              defaultValue={settings?.llm_model || ''}
              onBlur={e => updateSetting.mutate({ key: 'llm_model', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
      </Section>

      <Section title="Twenty CRM">
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm text-gray-600 mb-1">API URL</label>
            <input
              defaultValue={settings?.twenty_api_url || ''}
              onBlur={e => updateSetting.mutate({ key: 'twenty_api_url', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">API Token</label>
            <input
              type="password"
              defaultValue={settings?.twenty_api_token || ''}
              onBlur={e => updateSetting.mutate({ key: 'twenty_api_token', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
        </div>
      </Section>

      <Section title="Справочник компаний">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase">
              <th className="p-2">Код</th>
              <th className="p-2">Полное название</th>
              <th className="p-2">Twenty ID</th>
            </tr>
          </thead>
          <tbody>
            {(companies || []).map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="p-2 font-mono">{c.code}</td>
                <td className="p-2">{c.full_name}</td>
                <td className="p-2 text-gray-400 text-xs font-mono">{c.twenty_id || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Create Logs page**

Create `frontend/src/pages/Logs.jsx`:

```jsx
import { useLogs } from '../api';

export default function Logs() {
  const { data, isLoading } = useLogs();
  const logs = data?.logs || [];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Логи парсинга</h2>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Загрузка...</p>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Нет логов</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="p-3">Время</th>
                <th className="p-3">Статус</th>
                <th className="p-3">Событий</th>
                <th className="p-3">Новых</th>
                <th className="p-3">Обновлено</th>
                <th className="p-3">Пропущено</th>
                <th className="p-3">Длительность</th>
                <th className="p-3">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const duration = log.finished_at && log.started_at
                  ? Math.round((new Date(log.finished_at) - new Date(log.started_at)) / 1000)
                  : null;

                return (
                  <tr key={log.id} className="border-t border-gray-100">
                    <td className="p-3">{new Date(log.started_at).toLocaleString('ru-RU')}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        log.status === 'completed' ? 'bg-green-100 text-green-800'
                        : log.status === 'running' ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="p-3">{log.total_events ?? '—'}</td>
                    <td className="p-3">{log.new_deals ?? '—'}</td>
                    <td className="p-3">{log.updated_deals ?? '—'}</td>
                    <td className="p-3">{log.skipped_deals ?? '—'}</td>
                    <td className="p-3">{duration != null ? `${duration}с` : '—'}</td>
                    <td className="p-3 text-red-600 max-w-xs truncate">{log.error || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: settings page with keywords/auth/LLM/schedule and logs page"
```

---

## Task 15: Infrastructure — Docker, CI/CD

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `.github/workflows/docker-publish.yml`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./public
RUN mkdir -p /app/data
EXPOSE 3000
ENV DB_PATH=/app/data/crmparser.db
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.git
*.md
.env
data
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  crmparser:
    image: ghcr.io/3au4uk-1/crmparserv2:latest
    ports:
      - "3000:3000"
    volumes:
      - crmparser-data:/app/data
    environment:
      - CRM_BASE_URL=${CRM_BASE_URL:-https://apihide.com/bitrix/calendar/}
      - CRM_LOGIN=${CRM_LOGIN}
      - CRM_PASSWORD=${CRM_PASSWORD}
      - LLM_API_URL=${LLM_API_URL}
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_MODEL=${LLM_MODEL}
      - TWENTY_API_URL=${TWENTY_API_URL}
      - TWENTY_API_TOKEN=${TWENTY_API_TOKEN}
      - SESSION_SECRET=${SESSION_SECRET:-change-me-in-production}
    restart: unless-stopped

volumes:
  crmparser-data:
```

- [ ] **Step 4: Create `.github/workflows/docker-publish.yml`**

```yaml
name: Build and Push Docker Image

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GH_PAT }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha,prefix=

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 5: Verify Docker build locally**

Run:
```bash
docker build -t crmparser:test .
```
Expected: Build completes successfully.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Dockerfile, docker-compose, and GitHub Actions CI/CD"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Auth service (auto-login + cookie-fallback + token extraction) — Task 6
- [x] Parser (fetch events, descriptions, HTML parsing) — Tasks 4, 7
- [x] Title parser (company + manager) — Task 3
- [x] Classifier (keywords + LLM) — Task 5
- [x] Twenty sync (Company, Person, Opportunity, Note) — Task 8
- [x] Scheduler (cron) — Task 10
- [x] API routes (deals, parsing, settings, logs) — Task 9
- [x] Frontend: Dashboard — Task 12
- [x] Frontend: Deals with approval — Task 13
- [x] Frontend: Settings — Task 14
- [x] Frontend: Logs — Task 14
- [x] Database schema — Task 2
- [x] Docker + CI/CD — Task 15
- [x] .env.example — Task 1

**Placeholder scan:** No TBDs, TODOs, or vague steps found. All steps contain actual code.

**Type consistency:** Verified method names, DB column names, and API endpoints are consistent across tasks.
