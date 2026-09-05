# Telegram Bot Work Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обычный Telegram-бот принимает заявки из девяти топиков по закреплённой форме и ведёт их в Twenty (две канбан-доски); ответ публикуется правкой того же сообщения бота.

**Architecture:** Чистый парсер формы и слоты в `crmparserv2`; карточка — объект `telegramRequest` в `BrandingTwentyView`. Bot API (уже существующие webhook/polling) создаёт запись и пишет «принят». Смена стадии на `DONE` приходит вебхуком Twenty в парсер — `editMessageText`. Userbot заявки не создаёт.

**Tech Stack:** Node.js ESM, Vitest, better-sqlite3, Telegram Bot API (`callTelegram`), Twenty GraphQL (`createTwentyGqlClient` / `gql`), `uploadFilesFieldFile` из `backend/src/services/twenty-tasks.js`, twenty-sdk 2.31 (`defineObject` / `defineView` / `ViewType.KANBAN`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-telegram-bot-work-requests-design.md`
- Репозитории: `crmparserv2` (бот) и `BrandingTwentyView` (объект и доски)
- Заявки создаёт только Bot API, не userbot
- Стадии: `NEW` «Новый», `IN_PROGRESS` «В работе», `DONE` «Готовый»; create всегда `NEW`
- Типы: `QUOTE` | `LAYOUT` | `VISUAL` | `REVIEW`
- Бронь: после `Бронь:` trim и ровно `/^\d{6}$/`
- Пустые значения полей: нет строки, `''`, `-`, `нет`, `файл` (без учёта регистра)
- Носитель: `http://`/`https://` URL **или** photo/document в сообщении/альбоме
- Файлы: `MAX_FILE_BYTES = 20 * 1024 * 1024`; крупнее — в `largeFileUrls`, заявку не отвергать
- Альбом: ждать ~1000 мс все `media_group_id`, форма в caption первого
- `edited_message` не обрабатываем (не включать в `allowed_updates`)
- Отказ всегда заканчивается: `Не редактируй это сообщение — напиши новое с формой и тегом.`
- Успех: `Запрос #N принят. Ответ появится в этом сообщении.`
- «В работе» чат не трогает; «Готовый» без `replyText` — откат стадии
- Повторный `DONE` с тем же текстом не тегает повторно
- Все новые UUID — UUID v4
- Новые сущности Twenty: `yarn twenty dev:add`, затем привести имена к этому плану
- После правок app: `yarn twenty apply` в `BrandingTwentyView`
- Тесты парсера: `cd backend && npm test -- <file>`
- Тесты app: `cd BrandingTwentyView && yarn test:unit`

## File map

| File | Responsibility |
|------|----------------|
| `crmparserv2/backend/src/telegram/work-requests/parse-form.js` | Разбор ключей формы, валидация, роль топика |
| `crmparserv2/backend/src/telegram/work-requests/slots.js` | 9 слотов `{chatId,threadId,companyLabel,topicRole}` |
| `crmparserv2/backend/src/telegram/work-requests/store.js` | Номер заявки + связка SQLite |
| `crmparserv2/backend/src/telegram/work-requests/copy.js` | Тексты отказа/успеха/сбоя |
| `crmparserv2/backend/src/telegram/work-requests/match-deal.js` | Поиск Opportunity по брони / точному имени |
| `crmparserv2/backend/src/telegram/work-requests/mention.js` | Тег обычного бота в message/caption |
| `crmparserv2/backend/src/telegram/work-requests/files.js` | getFile, лимит 20 МБ, upload в Twenty FILES |
| `crmparserv2/backend/src/telegram/work-requests/twenty.js` | create/update `telegramRequest`, URL сообщения |
| `crmparserv2/backend/src/telegram/work-requests/album.js` | Сбор media_group |
| `crmparserv2/backend/src/telegram/work-requests/handle-inbound.js` | Оркестрация тега → карточка → reply |
| `crmparserv2/backend/src/telegram/work-requests/publish.js` | editMessageText + тег менеджера |
| `crmparserv2/backend/src/telegram/work-requests/handle-twenty-update.js` | DONE / пустой ответ / republish |
| `crmparserv2/backend/src/db/migrate.js` | Таблица `telegram_work_requests` + setting слотов |
| `crmparserv2/backend/src/telegram/inbound.js` | Discovery + `await emit('telegram.inbound')` |
| `crmparserv2/backend/src/telegram/register-default-hooks.js` | Регистрация inbound handler |
| `crmparserv2/backend/src/routes/telegram.js` | GET/PUT слотов |
| `crmparserv2/backend/src/routes/twenty-webhook.js` | `telegramRequest.*` → publish/revert, не в journal доски |
| `crmparserv2/backend/src/services/twenty-events/webhook-event.js` | Добавить `telegramRequest` в watched **нельзя** для journal доски — отдельный вызов publish из webhook router |
| `crmparserv2/backend/src/routes/twenty-webhook.js` | После journal: если object `telegramRequest` → handle update |
| `crmparserv2/frontend/src/pages/Telegram.jsx` | Секция «Заявки бота» — 9 слотов |
| `crmparserv2/frontend/src/api.js` | hooks слотов |
| `BrandingTwentyView/src/objects/telegram-request.object.ts` | Объект и поля |
| `BrandingTwentyView/src/fields/telegram-request-opportunity.field.ts` | Связь на opportunity + обратная |
| `BrandingTwentyView/src/views/telegram-requests-quotes.view.ts` | Канбан просчёты |
| `BrandingTwentyView/src/views/telegram-requests-design.view.ts` | Канбан разработка/проверка |
| `BrandingTwentyView/src/navigation-menu-items/telegram-requests-quotes.navigation-menu-item.ts` | Меню |
| `BrandingTwentyView/src/navigation-menu-items/telegram-requests-design.navigation-menu-item.ts` | Меню |
| `BrandingTwentyView/src/constants/telegram-request.ts` | Коды стадий/типов |
| `BrandingTwentyView/src/constants/universal-identifiers.ts` | UUID v4 |

---

### Task 1: Парсер формы

**Files:**
- Create: `crmparserv2/backend/src/telegram/work-requests/parse-form.js`
- Test: `crmparserv2/backend/tests/telegram-work-request-parse-form.test.js`

**Interfaces:**
- Consumes: текст сообщения + роль топика + список вложений `{ type: 'photo'|'document' }`
- Produces:
  - `TOPIC_ROLES = { QUOTE: 'QUOTE', DESIGN: 'DESIGN', REVIEW: 'REVIEW' }`
  - `KINDS = { QUOTE: 'QUOTE', LAYOUT: 'LAYOUT', VISUAL: 'VISUAL', REVIEW: 'REVIEW' }`
  - `isBlankFormValue(raw) → boolean`
  - `parseFormFields(text) → Record<string,string>` — ключ нормализуется: trim, lower, схлопнуть пробелы
  - `parseWorkRequestForm({ text, topicRole, attachments }) → { ok: true, data } | { ok: false, missing: string[] }`
  - `data` при ok:
    ```js
    {
      kind,           // KINDS.*
      brief,          // Что посчитать | ТЗ
      booking,        // '123456' | null
      positionName,   // string | null
      logoOrBrandUrl, // string | null
      layoutsUrl,     // string | null
      reviewAction,   // 'CHECK' | 'LAUNCH' | null
      dealName,       // из необязательной строки «Сделка:» | null
      hasCarrier,     // boolean
    }
    ```

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import {
  isBlankFormValue,
  parseFormFields,
  parseWorkRequestForm,
} from '../src/telegram/work-requests/parse-form.js';

describe('isBlankFormValue', () => {
  it.each(['', '  ', '-', 'нет', 'НЕТ', 'файл', 'Файл'])('treats %j as blank', (v) => {
    expect(isBlankFormValue(v)).toBe(true);
  });
  it('keeps a real value', () => {
    expect(isBlankFormValue('брединг 1')).toBe(false);
  });
});

describe('parseFormFields', () => {
  it('reads Key: value lines', () => {
    const fields = parseFormFields('@bot\nБронь: 123456\nТЗ: сделать макет');
    expect(fields['бронь']).toBe('123456');
    expect(fields['тз']).toBe('сделать макет');
  });
});

describe('parseWorkRequestForm', () => {
  it('accepts a quote with only brief', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nЧто посчитать: брендинг 1, 2',
      topicRole: 'QUOTE',
      attachments: [],
    });
    expect(r).toEqual({
      ok: true,
      data: expect.objectContaining({ kind: 'QUOTE', brief: 'брендинг 1, 2', booking: null }),
    });
  });

  it('rejects a quote without brief', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nЧто посчитать:',
      topicRole: 'QUOTE',
      attachments: [],
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('Что посчитать');
  });

  it('rejects booking that is not 6 digits', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nТип: макет\nБронь: 123-456\nТЗ: x\nНазвание позиции под брендинг: стойка',
      topicRole: 'DESIGN',
      attachments: [{ type: 'document' }],
    });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /бронь/i.test(m))).toBe(true);
  });

  it('accepts layout with file and blank logo url', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Тип: макет',
        'Бронь: 123456',
        'ТЗ: лого на стойку',
        'Название позиции под брендинг: стойка',
        'Ссылка на логотип / шрифт / брендбук:',
      ].join('\n'),
      topicRole: 'DESIGN',
      attachments: [{ type: 'document' }],
    });
    expect(r.ok).toBe(true);
    expect(r.data.kind).toBe('LAYOUT');
    expect(r.data.booking).toBe('123456');
  });

  it('rejects layout without url and without file', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nТип: макет\nБронь: 123456\nТЗ: x\nНазвание позиции под брендинг: y',
      topicRole: 'DESIGN',
      attachments: [],
    });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /ссылка или файл/i.test(m))).toBe(true);
  });

  it('accepts visual with layouts url and no file', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Тип: визуализация',
        'Бронь: 654321',
        'ТЗ: визуал',
        'Название позиции под брендинг: бар',
        'Ссылка на макеты: https://disk.example/a',
      ].join('\n'),
      topicRole: 'DESIGN',
      attachments: [],
    });
    expect(r.ok).toBe(true);
    expect(r.data.kind).toBe('VISUAL');
    expect(r.data.layoutsUrl).toBe('https://disk.example/a');
  });

  it('accepts review проверить + file', () => {
    const r = parseWorkRequestForm({
      text: [
        '@бот',
        'Бронь: 111222',
        'Комментарий: проверить',
        'Ссылка на макеты:',
        'Название позиции под брендинг: куб',
      ].join('\n'),
      topicRole: 'REVIEW',
      attachments: [{ type: 'photo' }],
    });
    expect(r.ok).toBe(true);
    expect(r.data.reviewAction).toBe('CHECK');
    expect(r.data.kind).toBe('REVIEW');
  });

  it('rejects review comment other than проверить/запускаем', () => {
    const r = parseWorkRequestForm({
      text: '@бот\nБронь: 111222\nКомментарий: срочно\nСсылка на макеты: https://x.test\nНазвание позиции под брендинг: куб',
      topicRole: 'REVIEW',
      attachments: [],
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Василий\Documents\projects\crmparserv2\backend && npm test -- telegram-work-request-parse-form.test.js`

Expected: FAIL — `Cannot find module` or export missing.

- [ ] **Step 3: Write minimal implementation**

`parse-form.js`:

- Нормализация ключей: `бронь`, `тз`, `что посчитать`, `тип`, `название позиции под брендинг`, `ссылка на логотип / шрифт / брендбук` (и короче: если ключ startsWith `ссылка на логотип`), `ссылка на макеты`, `комментарий`, `сделка`.
- URL: `trim` и `/^https?:\/\//i`.
- `QUOTE`: обязателен brief из `что посчитать`.
- `DESIGN`: `тип` ∈ `макет`|`визуализация`; бронь `/^\d{6}$/`; ТЗ; название позиции; носитель: LAYOUT → logo URL или attachment; VISUAL → layouts URL или attachment.
- `REVIEW`: бронь; комментарий `проверить`→`CHECK` / `запускаем`→`LAUNCH`; название позиции; layouts URL или attachment.
- `dealName` только если есть непустое `сделка`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `cd C:\Users\Василий\Documents\projects\crmparserv2\backend && npm test -- telegram-work-request-parse-form.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/work-requests/parse-form.js backend/tests/telegram-work-request-parse-form.test.js
git commit -m "feat: parse telegram work-request forms by topic role"
```

---

### Task 2: Слоты, номера, связка SQLite

**Files:**
- Create: `crmparserv2/backend/src/telegram/work-requests/slots.js`
- Create: `crmparserv2/backend/src/telegram/work-requests/store.js`
- Modify: `crmparserv2/backend/src/db/migrate.js` — в конце `migrate()`, перед `console.log`
- Test: `crmparserv2/backend/tests/telegram-work-request-store.test.js`

**Interfaces:**
- Consumes: better-sqlite3 `db`
- Produces:
  - `WORK_REQUEST_SLOTS_KEY = 'telegram_work_request_slots'`
  - `normalizeSlot(raw) → { chatId, threadId, companyLabel, topicRole } | null`
  - `getWorkRequestSlots(db) → slot[]` (валидные, макс 9, уникальные chatId+threadId)
  - `setWorkRequestSlots(db, slots) → slot[]` — кидает `{ status: 400 }` если роль не из `QUOTE|DESIGN|REVIEW` или threadId не положительное целое
  - `findSlot(db, chatId, threadId) → slot | null`
  - `allocateRequestNumber(db) → number` — `MAX(request_number)+1` или 1
  - `insertWorkRequestLink(db, row) → row` — идемпотентно по `(chat_id, source_message_id)`; если строка есть — вернуть существующую, не выдавать новый номер
  - `deleteWorkRequestLink(db, id)` — удалить строку без `twenty_id` после сбоя create
  - `getWorkRequestLinkByTwentyId(db, twentyId)`
  - `getWorkRequestLinkByAlbum(db, chatId, mediaGroupId)`
  - `updateWorkRequestLink(db, id, patch)` — camelCase patch: `botMessageId`, `twentyId`, `lastPublishedText`

Таблица (добавить в `migrate.js`):

```sql
CREATE TABLE IF NOT EXISTS telegram_work_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number INTEGER NOT NULL UNIQUE,
  twenty_id TEXT UNIQUE,
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  bot_message_id INTEGER,
  media_group_id TEXT,
  requester_user_id TEXT,
  requester_username TEXT,
  requester_name TEXT,
  last_published_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chat_id, source_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_twr_album
  ON telegram_work_requests(chat_id, media_group_id)
  WHERE media_group_id IS NOT NULL AND media_group_id != '';
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_work_request_slots', '[]');
```

- [ ] **Step 1: Write the failing test**

```js
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getWorkRequestSlots,
  setWorkRequestSlots,
  findSlot,
} from '../src/telegram/work-requests/slots.js';
import {
  insertWorkRequestLink,
} from '../src/telegram/work-requests/store.js';

function openMigrated() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_work_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_number INTEGER NOT NULL UNIQUE,
      twenty_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      source_message_id INTEGER NOT NULL,
      bot_message_id INTEGER,
      media_group_id TEXT,
      requester_user_id TEXT,
      requester_username TEXT,
      requester_name TEXT,
      last_published_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (chat_id, source_message_id)
    );
    INSERT INTO settings (key, value) VALUES ('telegram_work_request_slots', '[]');
  `);
  return db;
}

describe('work request slots', () => {
  it('starts empty and finds a saved slot', () => {
    const db = openMigrated();
    expect(getWorkRequestSlots(db)).toEqual([]);
    const slots = setWorkRequestSlots(db, [
      { chatId: '-1001', threadId: 12, companyLabel: 'Маяк', topicRole: 'QUOTE' },
    ]);
    expect(findSlot(db, '-1001', 12)?.topicRole).toBe('QUOTE');
    expect(slots).toHaveLength(1);
  });

  it('rejects bad topicRole', () => {
    const db = openMigrated();
    expect(() =>
      setWorkRequestSlots(db, [{ chatId: '-1', threadId: 1, companyLabel: 'X', topicRole: 'NOPE' }]),
    ).toThrow(/topicRole/);
  });
});

describe('work request store', () => {
  it('allocates incrementing numbers and is idempotent on the same message', () => {
    const db = openMigrated();
    const first = insertWorkRequestLink(db, {
      chatId: '-1001',
      threadId: 12,
      sourceMessageId: 77,
      requesterUserId: '5',
    });
    const again = insertWorkRequestLink(db, {
      chatId: '-1001',
      threadId: 12,
      sourceMessageId: 77,
      requesterUserId: '5',
    });
    expect(first.requestNumber).toBe(1);
    expect(again.id).toBe(first.id);
    expect(again.requestNumber).toBe(1);
    const second = insertWorkRequestLink(db, {
      chatId: '-1001',
      threadId: 12,
      sourceMessageId: 78,
    });
    expect(second.requestNumber).toBe(2);
  });
});
```

В `migrate()` (`backend/src/db/migrate.js`, вызывает `getDb()`) добавь тот же `CREATE TABLE telegram_work_requests` и `INSERT OR IGNORE` слотов. Тесты слотов/store не вызывают полный migrate — им достаточно `openMigrated()` выше.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Василий\Documents\projects\crmparserv2\backend && npm test -- telegram-work-request-store.test.js`

Expected: FAIL

- [ ] **Step 3: Implement slots.js, store.js, migrate SQL**

`insertWorkRequestLink`: `SELECT` по `chat_id+source_message_id`; если есть — return mapRow; иначе `allocateRequestNumber` и INSERT.

- [ ] **Step 4: Run tests**

Run: `cd C:\Users\Василий\Documents\projects\crmparserv2\backend && npm test -- telegram-work-request-store.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/work-requests/slots.js backend/src/telegram/work-requests/store.js backend/src/db/migrate.js backend/tests/telegram-work-request-store.test.js
git commit -m "feat: store telegram work-request slots and message links"
```

---

### Task 3: Тексты бота и матч сделки

**Files:**
- Create: `crmparserv2/backend/src/telegram/work-requests/copy.js`
- Create: `crmparserv2/backend/src/telegram/work-requests/match-deal.js`
- Test: `crmparserv2/backend/tests/telegram-work-request-copy.test.js`
- Test: `crmparserv2/backend/tests/telegram-work-request-match-deal.test.js`

**Interfaces:**
- Produces:
  - `REFUSAL_NEW_MESSAGE = 'Не редактируй это сообщение — напиши новое с формой и тегом.'`
  - `buildRefusalText(missing: string[]) → string` — маркированный список + пустая строка + константа
  - `buildAcceptedText(requestNumber) → string` — `Запрос #${n} принят. Ответ появится в этом сообщении.`
  - `buildCreateFailedText() → string` — `Не удалось взять в работу, напиши новое сообщение через минуту.`
  - `bookingInName(name, booking) → boolean` — `(^|\\D)booking(\\D|$)`
  - `pickMatchedOpportunity(nodes, { booking, dealName }) → { id, name } | null`
    - если `booking`: отфильтровать `bookingInName`; ровно 1 → он; иначе null
    - иначе если `dealName`: точное `node.name === dealName`; ровно 1 → он
  - `searchOpportunitiesByBooking(gql, booking) → nodes[]` — GraphQL ниже
  - `matchOpportunity({ gql, booking, dealName }) → { id, name } | null`

GraphQL:

```graphql
query SearchOpportunities($q: String!) {
  opportunities(filter: { name: { ilike: $q } }, first: 30) {
    edges { node { id name } }
  }
}
```

Для брони `q = \`%${booking}%\``. Для имени `q = dealName` с `eq` если ilike даст лишнее — после выборки всё равно `pickMatchedOpportunity`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, expect, it } from 'vitest';
import {
  REFUSAL_NEW_MESSAGE,
  buildRefusalText,
  buildAcceptedText,
} from '../src/telegram/work-requests/copy.js';
import { bookingInName, pickMatchedOpportunity } from '../src/telegram/work-requests/match-deal.js';

describe('copy', () => {
  it('refusal always asks for a new message', () => {
    const text = buildRefusalText(['Бронь — 6 цифр, пример: 123456']);
    expect(text).toContain('Бронь');
    expect(text.endsWith(REFUSAL_NEW_MESSAGE)).toBe(true);
  });
  it('accepted names the number', () => {
    expect(buildAcceptedText(42)).toBe(
      'Запрос #42 принят. Ответ появится в этом сообщении.',
    );
  });
});

describe('pickMatchedOpportunity', () => {
  const nodes = [
    { id: 'a', name: 'АРЕНДА/05.09/Маяк/123456/Иванов' },
    { id: 'b', name: 'АРЕНДА/05.09/Маяк/1234567/Петров' },
  ];
  it('matches exactly one 6-digit booking as its own number', () => {
    expect(pickMatchedOpportunity(nodes, { booking: '123456' })?.id).toBe('a');
  });
  it('returns null when two names contain the booking', () => {
    const dup = [...nodes, { id: 'c', name: 'другое 123456 ещё' }];
    expect(pickMatchedOpportunity(dup, { booking: '123456' })).toBe(null);
  });
  it('matches exact deal name when no booking', () => {
    expect(
      pickMatchedOpportunity([{ id: 'x', name: 'Ровно так' }], { dealName: 'Ровно так' })?.id,
    ).toBe('x');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

`npm test -- telegram-work-request-copy.test.js telegram-work-request-match-deal.test.js`

- [ ] **Step 3: Implement copy.js and match-deal.js**

`matchOpportunity`: если нет gql или Twenty — вернуть null (заявку всё равно создаём). Ошибку gql пробросить вызывающему, чтобы inbound показал `buildCreateFailedText`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/work-requests/copy.js backend/src/telegram/work-requests/match-deal.js backend/tests/telegram-work-request-copy.test.js backend/tests/telegram-work-request-match-deal.test.js
git commit -m "feat: work-request bot copy and opportunity booking match"
```

---

### Task 4: Объект Twenty, поля, две канбан-доски

**Files (BrandingTwentyView):**
- Create via `yarn twenty dev:add object` then edit: `src/objects/telegram-request.object.ts`
- Create: `src/fields/telegram-request-opportunity.field.ts` (и обратное поле на opportunity, как `supplier-deal-line-items.field.ts`)
- Create: `src/constants/telegram-request.ts`
- Modify: `src/constants/universal-identifiers.ts` — только UUID, которые сгенерировал `dev:add` (не выдумывать чужие)
- Create: `src/views/telegram-requests-quotes.view.ts`
- Create: `src/views/telegram-requests-design.view.ts`
- Create: `src/navigation-menu-items/telegram-requests-quotes.navigation-menu-item.ts`
- Create: `src/navigation-menu-items/telegram-requests-design.navigation-menu-item.ts`
- Create: `src/constants/telegram-request.test.ts`

**Interfaces:**
- Consumes: `OPPORTUNITY_OBJECT_UNIVERSAL_IDENTIFIER` из `src/constants/crm-objects.ts`
- Produces object `nameSingular: 'telegramRequest'`, `namePlural: 'telegramRequests'`, `labelSingular: 'Заявка бота'`, `labelPlural: 'Заявки бота'`, icon `IconRobot`
- Field names (API) — как в спеке:
  - `requestNumber` NUMBER
  - `stage` SELECT `NEW` / `IN_PROGRESS` / `DONE` (labels Новый / В работе / Готовый), default `NEW`
  - `kind` SELECT `QUOTE` / `LAYOUT` / `VISUAL` / `REVIEW`
  - `company` TEXT
  - `replyText` TEXT label «Ответ в чат»
  - `requesterName` TEXT
  - `requesterUsername` TEXT
  - `telegramMessageUrl` TEXT
  - `brief` TEXT
  - `booking` TEXT
  - `opportunity` RELATION MANY_TO_ONE → opportunity (`joinColumnName: 'opportunityId'`)
  - `positionName` TEXT
  - `logoOrBrandUrl` TEXT
  - `layoutsUrl` TEXT
  - `reviewAction` SELECT `CHECK` «проверить» / `LAUNCH` «запускаем», nullable
  - `largeFileUrls` TEXT
  - `notifyOnRepublish` BOOLEAN default false, label «Уведомить менеджера»
  - `republishRequested` BOOLEAN default false, label «Обновить в Telegram»
  - `publishError` TEXT
  - `requestFiles` FILES `maxNumberOfValues: 20`

Views:

```ts
import {
  defineView,
  ViewType,
  ViewFilterOperand,
} from 'twenty-sdk/define';

// quotes view
type: ViewType.KANBAN,
mainGroupByFieldMetadataUniversalIdentifier: STAGE_UID,
filters: [{
  universalIdentifier: '8f2a1c90-4b6d-4e31-a8c7-1d0e9f3a5b62',
  fieldMetadataUniversalIdentifier: KIND_UID,
  operand: ViewFilterOperand.IS,
  value: ['QUOTE'],
}],

// design view
type: ViewType.KANBAN,
mainGroupByFieldMetadataUniversalIdentifier: STAGE_UID,
filters: [{
  fieldMetadataUniversalIdentifier: KIND_UID,
  operand: ViewFilterOperand.IS,
  value: ['LAYOUT', 'VISUAL', 'REVIEW'],
}],
```

Nav: `NavigationMenuItemType.VIEW`, names «Просчёты» и «Разработка / проверка».

`src/constants/telegram-request.ts`:

```ts
export const TELEGRAM_REQUEST_STAGE = {
  NEW: 'NEW',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
} as const;

export const TELEGRAM_REQUEST_KIND = {
  QUOTE: 'QUOTE',
  LAYOUT: 'LAYOUT',
  VISUAL: 'VISUAL',
  REVIEW: 'REVIEW',
} as const;

export function canMoveToDone(replyText: string | null | undefined): boolean {
  return Boolean(replyText && replyText.trim());
}
```

- [ ] **Step 1: Write failing unit test**

```ts
import { describe, expect, it } from 'vitest';
import { canMoveToDone } from './telegram-request';

describe('canMoveToDone', () => {
  it('rejects empty reply', () => {
    expect(canMoveToDone('')).toBe(false);
    expect(canMoveToDone('   ')).toBe(false);
    expect(canMoveToDone(null)).toBe(false);
  });
  it('accepts text', () => {
    expect(canMoveToDone('готово, ссылка …')).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `yarn test:unit -- src/constants/telegram-request.test.ts` — FAIL пока файла нет

- [ ] **Step 3: Scaffold entities**

```bash
cd C:\Users\Василий\Documents\projects\BrandingTwentyView
yarn twenty dev:add object
# nameSingular telegramRequest
yarn twenty dev:add field   # повторить для RELATION opportunity и FILES если object-add не покрыл
yarn twenty dev:add view
yarn twenty dev:add navigationMenuItem
```

Привести имена полей и view к списку выше. UUID не переписывать после `dev:add`. Экспортировать STAGE/KIND UID в `universal-identifiers.ts`.

- [ ] **Step 4: `yarn test:unit -- src/constants/telegram-request.test.ts` и `yarn lint`**

Expected: PASS. `yarn twenty apply` на локали/staging — объект и две канбан-доски видны. Без apply не утверждать, что UI обновился.

- [ ] **Step 5: Commit в BrandingTwentyView**

```bash
git add src/objects/telegram-request.object.ts src/fields/telegram-request-opportunity.field.ts src/fields/opportunity-telegram-requests.field.ts src/views/telegram-requests-quotes.view.ts src/views/telegram-requests-design.view.ts src/navigation-menu-items/telegram-requests-quotes.navigation-menu-item.ts src/navigation-menu-items/telegram-requests-design.navigation-menu-item.ts src/constants/telegram-request.ts src/constants/telegram-request.test.ts src/constants/universal-identifiers.ts
git commit -m "feat: add telegramRequest object and two kanban views"
```

---

### Task 5: Twenty client — create/update и файлы

**Files:**
- Create: `crmparserv2/backend/src/telegram/work-requests/twenty.js`
- Create: `crmparserv2/backend/src/telegram/work-requests/files.js`
- Test: `crmparserv2/backend/tests/telegram-work-request-twenty.test.js`
- Test: `crmparserv2/backend/tests/telegram-work-request-files.test.js`

**Interfaces:**
- Produces:
  - `MAX_FILE_BYTES = 20971520`
  - `telegramMessageUrl(chatId, messageId) → string`  
    `-1001234567890` + msg `42` → `https://t.me/c/1234567890/42`
  - `createTelegramRequest(gql, input) → string` — Twenty record id
    ```
    mutation($data: TelegramRequestCreateInput!) {
      createTelegramRequest(data: $data) { id }
    }
    ```
  - `updateTelegramRequest(gql, id, input) → { id }`
    ```
    mutation($id: ID!, $data: TelegramRequestUpdateInput!) {
      updateTelegramRequest(id: $id, data: $data) { id }
    }
    ```
  - `classifyTelegramFile({ fileSize, mime }) → 'upload' | 'link'`
    - `fileSize > MAX_FILE_BYTES` → `'link'`
  - `downloadTelegramFile({ token, fileId, callTelegram, fetchImpl })`  
    `getFile` → `https://api.telegram.org/file/bot${token}/${file_path}` → `{ buffer, filename, contentType, fileSize }`
  - `uploadRequestFile({ buffer, filename, contentType, fieldMetadataId, uploadFilesFieldFile }) → { fileId }`  
    Обёртка над существующим `uploadFilesFieldFile` из `backend/src/services/twenty-tasks.js` (вынести upload в экспорт, если функция сейчас не exported: добавить `export { uploadFilesFieldFile }` или продублировать вызов через новый named export `export async function uploadFilesFieldFileForWorkRequest(...)` в `files.js`, копируя multipart-логику из `twenty-tasks.js` строки 210–255 — не импортировать неэкспортированное).

- [ ] **Step 1: Failing tests**

```js
import { describe, expect, it, vi } from 'vitest';
import { telegramMessageUrl, createTelegramRequest } from '../src/telegram/work-requests/twenty.js';
import { MAX_FILE_BYTES, classifyTelegramFile } from '../src/telegram/work-requests/files.js';

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
    // returns the id string, not `{ id }`
    expect(gql.mock.calls[0][0]).toMatch(/createTelegramRequest/);
  });
});

describe('classifyTelegramFile', () => {
  it('links oversized files', () => {
    expect(classifyTelegramFile({ fileSize: MAX_FILE_BYTES + 1 })).toBe('link');
    expect(classifyTelegramFile({ fileSize: 100 })).toBe('upload');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement twenty.js and files.js**

`createTelegramRequest` / `updateTelegramRequest`: `assertHttpSuccess` + `assertGqlSuccess` из `twenty-gql.js`. Если мутация ещё не существует до apply — тесты мокают gql, CI не бьёт живой Twenty.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/work-requests/twenty.js backend/src/telegram/work-requests/files.js backend/tests/telegram-work-request-twenty.test.js backend/tests/telegram-work-request-files.test.js
git commit -m "feat: create telegramRequest records and classify oversized files"
```

---

### Task 6: Inbound — тег, альбом, отказ/приём

**Files:**
- Create: `crmparserv2/backend/src/telegram/work-requests/mention.js`
- Create: `crmparserv2/backend/src/telegram/work-requests/album.js`
- Create: `crmparserv2/backend/src/telegram/work-requests/handle-inbound.js`
- Modify: `crmparserv2/backend/src/telegram/inbound.js` — сделать `processTelegramUpdate` async, после discovery `await emit('telegram.inbound', { db, update })`
- Modify: `crmparserv2/backend/src/telegram/register-default-hooks.js` — зарегистрировать handler
- Modify: `crmparserv2/backend/src/telegram/polling.js` — `await process(...)` (уже в try)
- Test: `crmparserv2/backend/tests/telegram-work-request-inbound.test.js`
- Test: `crmparserv2/backend/tests/telegram-work-request-mention.test.js`

**Interfaces:**
- `messageMentionsBot(message, botUsername) → boolean`
- `collectAlbumMessage(stateMap, message, { waitMs = 1000, now, schedule }) → Promise<message[]>`  
  Ключ: `${chatId}:${media_group_id}`. Пока нет `media_group_id` — сразу `[message]`.
- `handleWorkRequestInbound({ db, update, deps }) → { handled, action }`  
  `deps`: `getBotUsername`, `callTelegram`, `gql`, `downloadTelegramFile`, `uploadRequestFile`, `matchOpportunity`, `createTelegramRequest`, `clock`

Алгоритм `handleWorkRequestInbound`:

1. `msg = update.message` (не `edited_message`, не channel_post). Нет — `{ handled: false }`.
2. `from.is_bot` — skip.
3. `threadId = msg.message_thread_id`; `chatId = String(msg.chat.id)`.
4. `slot = findSlot(db, chatId, threadId)` — нет → `{ handled: false }` (discovery уже прошла).
5. `botUsername = await getBotUsername()`; нет mention → `{ handled: false }`.
6. Если `media_group_id` — `messages = await collectAlbum(...)`; обрабатывать только когда пачка полная. Повторный вызов того же group после INSERT — `{ action: 'duplicate' }` через `getWorkRequestLinkByAlbum`.
7. `text = messages[0].text || messages[0].caption || ''`.
8. `attachments` из всех messages: `photo` или `document`.
9. `parsed = parseWorkRequestForm({ text, topicRole: slot.topicRole, attachments })`.
10. Если `!parsed.ok` — `callTelegram(sendMessage)` reply на `msg.message_id`, `message_thread_id: threadId`, текст `buildRefusalText(parsed.missing)`. Не INSERT. `{ action: 'refused' }`.
11. `insertWorkRequestLink`. Если строка уже с `twenty_id` — `{ action: 'duplicate' }`, не слать второе «принят».
12. Скачать файлы: `getFile` + classify. upload → массив `{ fileId, label }`; oversized/failed → строки в `largeFileUrls` (`https://api.telegram.org/file/bot…` не класть публично без токена — писать `telegram-file:${file_unique_id} ${filename}` плюс `telegramMessageUrl` исходного тега).
13. `opp = await matchOpportunity({ gql, booking: parsed.data.booking, dealName: parsed.data.dealName })`.
14. `createTelegramRequest` со всеми полями, `stage: 'NEW'`, `company: slot.companyLabel`, `name: \`Запрос #${link.requestNumber}\``.
15. Если create бросил — `buildCreateFailedText()`, reply, **удалить** незавершённый link без `twenty_id` (`deleteWorkRequestLink(db, link.id)` — добавить в store). `{ action: 'create_failed' }`.
16. `updateWorkRequestLink({ twenty_id })`.
17. `sendMessage` `buildAcceptedText(n)`, reply_to source. Сохранить `bot_message_id`. `{ action: 'accepted' }`.

`getBotUsername`: `getMe` один раз, кэш в settings `telegram_bot_username`.

- [ ] **Step 1: Failing tests**

```js
import { describe, expect, it, vi } from 'vitest';
import { messageMentionsBot } from '../src/telegram/work-requests/mention.js';
import { handleWorkRequestInbound } from '../src/telegram/work-requests/handle-inbound.js';
import { setWorkRequestSlots } from '../src/telegram/work-requests/slots.js';
import Database from 'better-sqlite3';

function openMigrated() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_work_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_number INTEGER NOT NULL UNIQUE,
      twenty_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      source_message_id INTEGER NOT NULL,
      bot_message_id INTEGER,
      media_group_id TEXT,
      requester_user_id TEXT,
      requester_username TEXT,
      requester_name TEXT,
      last_published_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (chat_id, source_message_id)
    );
    INSERT INTO settings (key, value) VALUES ('telegram_work_request_slots', '[]');
  `);
  return db;
}

describe('messageMentionsBot', () => {
  it('detects @username mention entity', () => {
    const msg = {
      text: '@intake_bot\nЧто посчитать: x',
      entities: [{ type: 'mention', offset: 0, length: 12 }],
    };
    expect(messageMentionsBot(msg, 'intake_bot')).toBe(true);
    expect(messageMentionsBot(msg, 'other')).toBe(false);
  });
});

function seedQuoteSlot(db) {
  setWorkRequestSlots(db, [
    { chatId: '-1001', threadId: 12, companyLabel: 'Маяк', topicRole: 'QUOTE' },
  ]);
  return db;
}

describe('handleWorkRequestInbound', () => {
  it('refuses incomplete quote and does not create Twenty row', async () => {
    const db = seedQuoteSlot(openMigrated());
    const callTelegram = vi.fn();
    const createTelegramRequest = vi.fn();
    const result = await handleWorkRequestInbound({
      db,
      update: {
        message: {
          message_id: 10,
          message_thread_id: 12,
          chat: { id: -1001 },
          text: '@intake_bot',
          entities: [{ type: 'mention', offset: 0, length: 12 }],
          from: { id: 7, username: 'm', first_name: 'M', is_bot: false },
        },
      },
      deps: {
        getBotUsername: async () => 'intake_bot',
        callTelegram,
        createTelegramRequest,
        gql: vi.fn(),
      },
    });
    expect(result.action).toBe('refused');
    expect(createTelegramRequest).not.toHaveBeenCalled();
    expect(callTelegram).toHaveBeenCalledWith(
      expect.anything(),
      'sendMessage',
      expect.objectContaining({
        reply_to_message_id: 10,
        text: expect.stringContaining('напиши новое'),
      }),
    );
  });

  it('creates Twenty row and replies accepted', async () => {
    const callTelegram = vi.fn().mockResolvedValue({ message_id: 99 });
    const createTelegramRequest = vi.fn().mockResolvedValue('tw-1');
    const result = await handleWorkRequestInbound({
      db: seedQuoteSlot(openMigrated()),
      update: {
        message: {
          message_id: 11,
          message_thread_id: 12,
          chat: { id: -1001 },
          text: '@intake_bot\nЧто посчитать: брендинг 1',
          entities: [{ type: 'mention', offset: 0, length: 12 }],
          from: { id: 7, username: 'm', first_name: 'M', is_bot: false },
        },
      },
      deps: {
        getBotUsername: async () => 'intake_bot',
        callTelegram,
        createTelegramRequest,
        matchOpportunity: async () => null,
        gql: vi.fn(),
      },
    });
    expect(result.action).toBe('accepted');
    expect(createTelegramRequest).toHaveBeenCalled();
    expect(callTelegram.mock.calls.some((c) => String(c[2].text).includes('Запрос #'))).toBe(true);
  });
});
```

В тесте подними реальный `:memory:` + `migrate` + `setWorkRequestSlots`. Token в settings не обязателен, если `callTelegram` замокан и handler берёт token из deps (`deps.token || getTelegramBotToken(db)`).

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement mention, album, handle-inbound; wire emit**

`inbound.js`:

```js
export async function processTelegramUpdate(db, update) {
  // existing discovery (sync) ...
  await emit('telegram.inbound', { db, update });
}

export async function handleTelegramWebhook(req, res) {
  // secret check unchanged
  try {
    await processTelegramUpdate(db, req.body || {});
  } catch (err) {
    console.error('[telegram] webhook process error:', err.message);
  }
  return res.json({ ok: true });
}
```

`register-default-hooks.js`:

```js
import { handleWorkRequestInbound } from './work-requests/handle-inbound.js';

export function registerDefaultTelegramHooks() {
  registerHook('okleyka.send.after', async () => {});
  registerHook('telegram.inbound', async (ctx) => {
    await handleWorkRequestInbound(ctx);
  });
}
```

Существующие тесты `telegram-inbound` / polling: добавить `await` где зовут `processTelegramUpdate`. Прогнать `npm test -- telegram-polling.test.js telegram-bot-admin.test.js` если они импортируют inbound.

- [ ] **Step 4: PASS inbound + polling tests**

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/work-requests backend/src/telegram/inbound.js backend/src/telegram/register-default-hooks.js backend/src/telegram/polling.js backend/tests/telegram-work-request-inbound.test.js backend/tests/telegram-work-request-mention.test.js backend/tests/telegram-polling.test.js
git commit -m "feat: accept or refuse work-request mentions in configured topics"
```

---

### Task 7: Публикация в чат, откат пустого DONE, обновление

**Files:**
- Create: `crmparserv2/backend/src/telegram/work-requests/publish.js`
- Create: `crmparserv2/backend/src/telegram/work-requests/handle-twenty-update.js`
- Modify: `crmparserv2/backend/src/routes/twenty-webhook.js` — после verify, если `objectMetadata.nameSingular === 'telegramRequest'` (или `eventName` starts with `telegramRequest.`), вызвать handler; journal доски не засорять (не добавлять в `WATCHED_OBJECT_NAMES`)
- Test: `crmparserv2/backend/tests/telegram-work-request-publish.test.js`

**Interfaces:**
- `escapeHtml(s)`
- `buildDoneMessageHtml({ replyText, requesterUserId, requesterUsername, requesterName, mention }) → string`  
  Если `mention`: сначала `<a href="tg://user?id=${id}">${escapeHtml(name||username||'менеджер')}</a>` либо `@{username}`, затем `\n\n` и `escapeHtml(replyText)`. Без mention — только escapeHtml(replyText).
- `publishWorkRequestReply({ db, token, link, replyText, mention, callTelegram })`  
  `editMessageText` `{ chat_id, message_id: link.bot_message_id, text, parse_mode: 'HTML' }`. Успех → `updateWorkRequestLink({ last_published_text: replyText })`.
- `handleTelegramRequestRecordEvent({ db, payload, deps })`
  - `after = payload.record || payload.properties.after`
  - `before = payload.properties.before`
  - `link = getWorkRequestLinkByTwentyId(db, after.id)` — нет → `{ action: 'no_link' }`, `updateTelegramRequest(publishError: 'нет связки с чатом')` если gql есть
  - если `after.stage === 'DONE' && !after.replyText?.trim()` → `updateTelegramRequest(id, { stage: before?.stage || 'IN_PROGRESS', publishError: 'Сначала заполни «Ответ в чат»' })`, чат не трогать, `{ action: 'reverted' }`
  - если `after.stage === 'DONE' && replyText`:
    - `mention = true` при первом переходе в DONE (`before?.stage !== 'DONE'`)
    - если `before?.stage === 'DONE'` и `after.replyText === link.last_published_text` и не `after.republishRequested` → `{ action: 'noop' }`
    - иначе publish; при первом DONE mention true; при `republishRequested` mention = `Boolean(after.notifyOnRepublish)`
    - после republish: `updateTelegramRequest({ republishRequested: false, publishError: '' })`
  - `IN_PROGRESS` / `NEW` — `{ action: 'ignore' }`

- [ ] **Step 1: Failing tests**

```js
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { buildDoneMessageHtml } from '../src/telegram/work-requests/publish.js';
import { handleTelegramRequestRecordEvent } from '../src/telegram/work-requests/handle-twenty-update.js';
import { insertWorkRequestLink, updateWorkRequestLink } from '../src/telegram/work-requests/store.js';

function dbWithLink({ lastPublishedText = null } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_work_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_number INTEGER NOT NULL UNIQUE,
      twenty_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      source_message_id INTEGER NOT NULL,
      bot_message_id INTEGER,
      media_group_id TEXT,
      requester_user_id TEXT,
      requester_username TEXT,
      requester_name TEXT,
      last_published_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (chat_id, source_message_id)
    );
  `);
  const link = insertWorkRequestLink(db, {
    chatId: '-1001',
    threadId: 12,
    sourceMessageId: 11,
    requesterUserId: '7',
  });
  updateWorkRequestLink(db, link.id, {
    twentyId: 'tw-1',
    botMessageId: 99,
    lastPublishedText,
  });
  return db;
}

describe('buildDoneMessageHtml', () => {
  it('mentions by user id', () => {
    const html = buildDoneMessageHtml({
      replyText: 'Сумма 10к',
      requesterUserId: '7',
      requesterName: 'Ира',
      mention: true,
    });
    expect(html).toContain('tg://user?id=7');
    expect(html).toContain('Сумма 10к');
  });
  it('omits mention when flag is off', () => {
    const html = buildDoneMessageHtml({
      replyText: 'Правка опечатки',
      requesterUsername: 'ira',
      mention: false,
    });
    expect(html).not.toContain('@ira');
    expect(html).toBe('Правка опечатки');
  });
});

describe('handleTelegramRequestRecordEvent', () => {
  it('reverts DONE without replyText', async () => {
    const updateTelegramRequest = vi.fn();
    const publish = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: {
        eventName: 'telegramRequest.updated',
        objectMetadata: { nameSingular: 'telegramRequest' },
        record: { id: 'tw-1', stage: 'DONE', replyText: '' },
        properties: { before: { stage: 'IN_PROGRESS' }, after: { id: 'tw-1', stage: 'DONE', replyText: '' } },
      },
      deps: { updateTelegramRequest, publishWorkRequestReply: publish },
    });
    expect(result.action).toBe('reverted');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).toHaveBeenCalledWith(
      'tw-1',
      expect.objectContaining({ stage: 'IN_PROGRESS' }),
    );
  });

  it('does not mention again on identical DONE text', async () => {
    const publish = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink({ lastPublishedText: 'ok' }),
      payload: {
        eventName: 'telegramRequest.updated',
        record: { id: 'tw-1', stage: 'DONE', replyText: 'ok', republishRequested: false },
        properties: {
          before: { stage: 'DONE', replyText: 'ok' },
          after: { id: 'tw-1', stage: 'DONE', replyText: 'ok', republishRequested: false },
        },
      },
      deps: { publishWorkRequestReply: publish, updateTelegramRequest: vi.fn() },
    });
    expect(result.action).toBe('noop');
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement publish + webhook branch**

В `twenty-webhook.js` после verify (даже если events journal disabled):

```js
const name = req.body?.objectMetadata?.nameSingular || String(req.body?.eventName || '').split('.')[0];
if (name === 'telegramRequest') {
  const { getDb } = await import('../db/connection.js');
  const { handleTelegramRequestRecordEvent } = await import('../telegram/work-requests/handle-twenty-update.js');
  handleTelegramRequestRecordEvent({ db: getDb(), payload: req.body }).catch((err) => {
    console.error('[telegram-request] webhook handler', err.message);
  });
}
```

Не блокировать 200 дольше 5 с — Twenty ретраит. Handler fire-and-forget после `res.json`, **либо** дождаться publish (обычно <1 с). Предпочтительно `await` внутри try и всё равно ответить 200, ошибки публикации писать в `publishError`.

- [ ] **Step 4: PASS** и `npm test -- telegram-events-route.test.js` (вебхук доски не сломан)

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/work-requests/publish.js backend/src/telegram/work-requests/handle-twenty-update.js backend/src/routes/twenty-webhook.js backend/tests/telegram-work-request-publish.test.js
git commit -m "feat: publish work-request answers when Twenty stage is DONE"
```

---

### Task 8: UI слотов на странице Telegram

**Files:**
- Modify: `crmparserv2/backend/src/routes/telegram.js` — GET/PUT `/work-request-slots`
- Modify: `crmparserv2/frontend/src/api.js` — `useTelegramWorkRequestSlots`, `useSaveTelegramWorkRequestSlots`
- Modify: `crmparserv2/frontend/src/pages/Telegram.jsx` — секция после mention-forward
- Test: `crmparserv2/backend/tests/telegram-work-request-slots-route.test.js`  
  Скопировать стиль `backend/tests/telegram-userbot-auth-routes.test.js` (supertest + in-memory db).

**Interfaces:**
- `GET /api/telegram/work-request-slots` → `{ slots: Slot[] }`
- `PUT /api/telegram/work-request-slots` body `{ slots: Slot[] }` → `{ slots }`
- Slot: `{ chatId: string, threadId: number, companyLabel: string, topicRole: 'QUOTE'|'DESIGN'|'REVIEW' }`

UI: до 9 строк. Каждая: select чата (как digest), select топика если форум, input «Компания», select роли «Просчёт / Разработка / Проверка». Кнопка «Сохранить». Пустые строки (нет chatId) отбрасывать в `setWorkRequestSlots`.

- [ ] **Step 1: Failing route test**

```js
it('PUT validates topicRole and GET returns slots', async () => {
  const res = await request(app).put('/api/telegram/work-request-slots').send({
    slots: [{ chatId: '-1001', threadId: 3, companyLabel: 'Маяк', topicRole: 'REVIEW' }],
  });
  expect(res.status).toBe(200);
  const get = await request(app).get('/api/telegram/work-request-slots');
  expect(get.body.slots[0].topicRole).toBe('REVIEW');
});
```

Подключить тот же auth, что другие telegram routes (`appAuthMiddleware` уже на `/api/telegram` кроме webhook).

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Routes + React section**

Не тащить новую дизайн-систему: `Section`, `FieldLabel`, `select-field`, `btn-primary` как у «Пересылка упоминаний».

- [ ] **Step 4: Route tests PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/telegram.js backend/tests/telegram-work-request-slots-route.test.js frontend/src/api.js frontend/src/pages/Telegram.jsx
git commit -m "feat: configure nine work-request topic slots on Telegram page"
```

---

### Task 9: Изоляция userbot и ручной прогон

**Files:**
- Test: `crmparserv2/backend/tests/telegram-work-request-userbot-isolation.test.js`
- Modify only if test найдёт импорт: userbot файлы **не** должны импортировать `work-requests/handle-inbound.js`

**Interfaces:**
- Produces: гарантия спеки «userbot не создаёт telegramRequest»

- [ ] **Step 1: Write the test**

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../src/telegram/userbot');
const files = [
  'mention-forward.js',
  'digest-commands.js',
  'team-app-mirror.js',
  'actions.js',
  'client.js',
];

describe('userbot does not own work requests', () => {
  it('does not import work-requests inbound', () => {
    for (const f of files) {
      const src = readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(/work-requests\/handle-inbound/);
      expect(src).not.toMatch(/createTelegramRequest/);
    }
  });
});
```

- [ ] **Step 2: Run** — должен PASS без правок. Если FAIL — убрать ошибочный импорт, не добавлять inbound в userbot.

- [ ] **Step 3: Прогнать набор**

```bash
cd C:\Users\Василий\Documents\projects\crmparserv2\backend
npm test -- telegram-work-request
```

Expected: все `telegram-work-request*` PASS.

В `BrandingTwentyView`: `yarn test:unit -- src/constants/telegram-request.test.ts` и `yarn twenty apply`.

- [ ] **Step 4: Staging checklist (руками, не CI)**

1. Заполнить 3 слота одного чата на `/telegram`.
2. Закреп с формой; `@username` обычного бота.
3. Неполный тег → отказ + «напиши новое»; правкой старого карточка не появляется.
4. Полный просчёт → карточка «Новый» на доске Просчёты, reply «принят».
5. Перевод в «В работе» — сообщение бота не меняется.
6. Без «Ответ в чат» в «Готовый» — стадия откатывается, `publishError` виден.
7. С ответом в «Готовый» — edit + тег менеджера.
8. Правка ответа + галка «Уведомить» + «Обновить в Telegram» — edit и тег; без галки — edit без тега.
9. Макет: пустая ссылка + файл → приём; файл > 20 МБ → заявка есть, файл в `largeFileUrls`.
10. Бронь 6 цифр из имени существующей сделки → связь кликабельна; битая бронь → отказ в чате.
11. Тег userbot в том же топике → новой заявки нет.

- [ ] **Step 5: Commit isolation test**

```bash
git add backend/tests/telegram-work-request-userbot-isolation.test.js
git commit -m "test: keep work-request intake off the userbot client"
```

---

## Self-review (spec coverage)

| Спека | Задача |
|---|---|
| Формы, бронь, пустые синонимы, ссылка или файл | 1 |
| Слоты 9×, молчание вне слота | 2, 6, 8 |
| Номер, идемпотентность message/album | 2, 6 |
| Тексты отказа/принят/сбой, «напиши новое» | 3, 6 |
| Матч брони / точного имени | 3, 6 |
| Объект, поля, две канбан, меню | 4 |
| Create в NEW, файлы ≤20 МБ / ссылки | 5, 6 |
| Inbound mention, альбом, не edited | 6 |
| DONE → edit + тег; IN_PROGRESS тишина | 7 |
| Пустой DONE откат | 7 |
| Обновить ± уведомить | 7 (`republishRequested` + `notifyOnRepublish`) |
| UI слотов | 8 |
| Userbot не создаёт заявки | 9 |
| Печать макетов / перенос дайджестов | вне плана (спека Non-scope) |
