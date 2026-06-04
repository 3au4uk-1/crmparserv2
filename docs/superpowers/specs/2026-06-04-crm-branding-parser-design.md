# CRM Branding Parser — Design Spec

**Дата:** 2026-06-04
**Статус:** Утверждён

## Цель

Автоматизировать ежевечернюю ручную работу: вместо того чтобы открывать каждую сделку в CRM-календаре (`apihide.com/bitrix/calendar/dashboard.php`), искать брендинговые позиции и переносить их вручную — система делает это автоматически. Результат: отфильтрованные данные попадают в Twenty CRM отдела брендинга.

## Контекст

- CRM-календарь — внутренняя система компании на jQuery + FullCalendar, серверный рендеринг
- Доступ к редактированию кода CRM отсутствует
- CRM предоставляет AJAX-эндпоинты для получения данных
- Twenty CRM развёрнут, имеет GraphQL API
- Отдел работает с тремя компаниями: ПРО, АРТ, АРЕНДА

## Архитектура

### Общая схема

```
CRM Calendar ──→ Parser Service ──→ Classifier ──→ Local DB ──→ Approval Queue ──→ Twenty CRM
     ↑                                  ↑
  Auth Service                    Keywords + LLM
```

### Компоненты

**Backend (Node.js + Express)**

| Сервис | Ответственность |
|--------|----------------|
| Auth Service | Авторизация в CRM (auto-login + cookie-fallback) |
| Parser Service | Получение и парсинг сделок из CRM |
| Classifier Service | Фильтрация позиций (ключевые слова + LLM) |
| Twenty Sync Service | Синхронизация с Twenty CRM через GraphQL API |
| Scheduler | Cron-задачи для автоматического парсинга |

**Frontend (React + Vite + Tailwind CSS + TanStack Query)**

| Страница | Назначение |
|----------|-----------|
| Дашборд | Статус, статистика, ошибки |
| Сделки | Таблица сделок с позициями, апрув/отклонение |
| Настройки | Credentials, ключевые слова, LLM, Twenty, расписание |
| Логи | История парсингов и синхронизаций |

**Инфраструктура**

- Docker (multi-stage build, один контейнер)
- GitHub Actions → GHCR (авторизация через `GH_PAT`)
- Portainer для деплоя
- SQLite в Docker volume

## Авторизация в CRM

Двойной режим:

### 1. Auto-login (основной)

POST на форму логина CRM с login/password → получение session cookies → загрузка `dashboard.php` → извлечение токена из скрытого поля `<input id="cal_token">` → использование токена во всех последующих API-запросах. Поддержание сессии периодическими GET к `keep.php` (каждые 5 минут, как делает сам CRM).

### 2. Cookie-fallback (запасной)

Пользователь вставляет cookies из DevTools браузера через UI. Система использует их напрямую, пропуская логин. Токен всё равно извлекается из dashboard.php при первом запросе.

### Переключение

Если auto-login возвращает ошибку 3 раза подряд → уведомление в UI + переключение на cookie-fallback. Пользователь также может принудительно выбрать режим в настройках.

## Парсинг

### Источники данных

**Список сделок:** `GET includes/cal_events.php?token={token}&start={unix}&end={unix}`

Возвращает JSON-массив событий. Каждое событие содержит:
- `original_id` — внутренний ID события
- `leadid` — ID сделки в Bitrix24
- `title` — название (структурированная строка)
- `start`, `end` — даты
- `department` — категория
- `is_branding` — флаг наличия брендинга
- `brand` — бренд

**Детали сделки:** `POST includes/cal_description.php` с `{id: original_id, mode: "edit"}`

Возвращает JSON:
```json
{
  "description": "<HTML с метаданными и таблицей позиций>",
  "description_editable": "...",
  "color": "...",
  "category": "...",
  "payments": {...},
  ...
}
```

### Парсинг HTML описания

Из HTML-поля `description` извлекаются:

**Метаданные сделки:**
- Статус сделки
- Юр. лицо
- Номер счёта
- Бюджет
- Скидка

**Контактная информация:**
- Контактное лицо
- E-Mail
- Компания
- Телефон

**Детали мероприятия:**
- Адрес проведения
- Время (приезд, готовность, работа, демонтаж)
- Место проведения

**Таблица позиций** (`table.table-caption`):
Каждая строка содержит:
- Название позиции
- Итого (руб.)
- Количество
- Сумма скидки

### Парсинг названия сделки

Формат: `{КОМПАНИЯ}/{ДАТЫ}/{...контекст...}/{МЕНЕДЖЕР}`

Пример: `ПРО/29.05-05.06./КАПЫ/ЛУЖНИКИ/В МОМЕНТЕ/167015 /ДОЗАБОР+ПРОДЛЕНИЕ/168973/Шунькин`

Извлекаем:
- **Компания:** первый сегмент (`ПРО`)
- **Менеджер:** последний сегмент (`Шунькин`)

Справочник компаний (настраиваемый):
| Код | Полное название |
|-----|----------------|
| ПРО | ProInteractive |
| АРТ | Art-Active |
| АРЕНДА | Arenda |

### Защита от нагрузки

- Запросы к `cal_description.php` — последовательно с задержкой 300-500ms
- Кэширование: hash содержимого сделки, при повторном парсинге неизменённые пропускаются

## Классификация позиций

Двухступенчатая:

### 1. Keyword matching (быстро, бесплатно)

Редактируемый список ключевых слов (через UI). Позиция проверяется на вхождение ключевых слов в название. Результат:
- Совпадение → `classification: keyword_match`
- Нет совпадения → переходит на шаг 2

### 2. LLM-классификация

Позиции без keyword-совпадения отправляются пакетом в LLM (OpenAI-compatible API). Промпт содержит контекст отдела и список позиций. LLM возвращает `yes/no` + уверенность. Результат:
- `classification: llm_confirmed` или `classification: llm_rejected`

Настройки LLM (через UI): API endpoint, API key, модель, промпт.

## Процесс апрува

Три режима (переключаются в настройках):

### 1. Ручной апрув (по умолчанию)

Все классифицированные сделки попадают в очередь. В UI:
- Сделка с метаданными
- Все позиции, брендинговые выделены визуально
- Кнопки: подтвердить (→ отправить в Twenty), отклонить, редактировать список позиций

### 2. Полуавтоматический

- `keyword_match` → автоматически в Twenty
- `llm_confirmed` → в очередь на апрув

### 3. Полный автоапрув

Всё классифицированное как брендинг отправляется автоматически.

## Синхронизация с Twenty CRM

Через GraphQL API Twenty:

### Маппинг сущностей

| CRM Parser | Twenty CRM | Логика |
|-----------|-----------|--------|
| Компания (ПРО/АРТ/АРЕНДА) | Company | Поиск по коду, создание если нет |
| Менеджер (из названия) | Person → привязан к Company | Поиск по фамилии внутри компании |
| Сделка | Opportunity → привязан к Company + Person | Создание с метаданными |
| Брендинговые позиции | Note на Opportunity (или кастомный объект) | Список позиций с ценами |

### Дедупликация

Каждая синхронизированная сделка получает `synced_to_twenty: true` + `twenty_id`. При повторном парсинге — обновление существующей записи, не дублирование.

## Хранение данных (SQLite)

### Таблицы

- `deals` — распарсенные сделки (метаданные, статус апрува, twenty_id, content_hash)
- `deal_items` — позиции сделок (название, цена, кол-во, classification)
- `parse_runs` — история запусков парсинга (время, статус, количество сделок)
- `settings` — настройки (ключевые слова, расписание, режим апрува)
- `companies` — справочник компаний (код → полное название → twenty_id)
- `managers` — справочник менеджеров (фамилия → company_id → twenty_id)

## Frontend

### Технологии

- React 18+ с Vite
- TanStack Query для работы с API
- Tailwind CSS
- React Router

### Страницы

**Дашборд:**
- Карточки: всего сделок, ожидают апрува, синхронизировано, ошибки
- Статус последнего парсинга (время, результат)
- Кнопка ручного запуска

**Сделки:**
- Таблица с колонками: дата, название, компания, менеджер, кол-во позиций (брендинг), бюджет, статус
- Фильтры: по дате, компании, статусу
- Раскрытие строки: все позиции, брендинговые выделены цветом
- Массовый апрув/отклонение

**Настройки:**
- CRM credentials (login/password, cookies, режим авторизации)
- Ключевые слова (добавление, удаление, редактирование)
- LLM (endpoint, key, модель)
- Twenty CRM (URL, API token)
- Расписание парсинга (cron-выражение или UI-выбор)
- Режим апрува (ручной / полуавто / автоапрув)
- Справочник компаний

**Логи:**
- Таблица: время, тип (парсинг/синхронизация), статус, детали

## Инфраструктура

### Dockerfile

```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --production
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./public
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### GitHub Actions

Триггер: push в `main`. Авторизация в GHCR через `GH_PAT`.

```yaml
- name: Login to GHCR
  uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GH_PAT }}

- name: Build and push
  uses: docker/build-push-action@v5
  with:
    push: true
    tags: |
      ghcr.io/${{ github.repository }}:latest
      ghcr.io/${{ github.repository }}:${{ github.sha }}
```

### docker-compose.yml (для Portainer)

```yaml
services:
  crmparser:
    image: ghcr.io/{owner}/crmparserv2:latest
    ports:
      - "3000:3000"
    volumes:
      - crmparser-data:/app/data
    environment:
      - CRM_LOGIN=
      - CRM_PASSWORD=
      - LLM_API_KEY=
      - LLM_API_URL=
      - LLM_MODEL=
      - TWENTY_API_URL=
      - TWENTY_API_TOKEN=
      - SESSION_SECRET=
    restart: unless-stopped

volumes:
  crmparser-data:
```

### Переменные окружения

| Переменная | Описание |
|-----------|---------|
| `CRM_LOGIN` | Логин для CRM-календаря |
| `CRM_PASSWORD` | Пароль для CRM-календаря |
| `CRM_BASE_URL` | Базовый URL CRM (default: `https://apihide.com/bitrix/calendar/`) |
| `LLM_API_KEY` | API-ключ для LLM |
| `LLM_API_URL` | URL эндпоинта LLM (OpenAI-compatible) |
| `LLM_MODEL` | Модель LLM |
| `TWENTY_API_URL` | URL Twenty CRM GraphQL API |
| `TWENTY_API_TOKEN` | API-токен Twenty CRM |
| `SESSION_SECRET` | Секрет для сессий Express |
| `PORT` | Порт (default: 3000) |

## Ошибки и edge cases

- **Сессия CRM истекла:** автоматический re-login, если не помогло — уведомление + fallback на cookies
- **CRM недоступен:** retry с exponential backoff (3 попытки), логирование ошибки
- **LLM недоступен:** позиции без keyword-match остаются с `classification: unclassified`, обрабатываются при следующем запуске
- **Twenty недоступен:** сделки остаются в очереди `approved`, retry при следующем цикле
- **Дубликаты:** content_hash предотвращает повторную обработку; twenty_id предотвращает дублирование в Twenty
- **Пустая таблица позиций:** сделка сохраняется, но помечается как `no_items`
- **Название сделки нестандартного формата:** парсинг best-effort, если не удалось извлечь компанию/менеджера — помечается для ручной обработки
