# Пересылка упоминаний user-bot в топик общей беседы

Дата: 2026-07-31. Статус: одобрено пользователем (чат).

## Задача

Когда аккаунт user-bot тегают в рабочем чате (куда его добавляет логистика),
сообщение с упоминанием автоматически пересылается в общую беседу
(форум «Общий брендинг») в один фиксированный топик (например «Упоминания»).

## Решения, принятые с пользователем

- Один фиксированный топик для всех упоминаний (не по топику на чат).
- Триггер — только явные упоминания аккаунта user-bot (флаг `mentioned` MTProto:
  покрывает `@username` и text-mention). Ответы (reply) без тега не пересылаются.
- Источник — любые группы/супергруппы, где состоит user-bot, кроме самой целевой беседы.
  Личка и каналы игнорируются.

## Архитектура

Live-обработчик событий GramJS (клиент уже держит постоянное соединение
из-за reconcile-цикла). Вариант с опросом `messages.GetUnreadMentions` отклонён:
задержка до 30 с, лишние запросы, влияет на статус «прочитано».

### Компоненты

1. **Настройки** (`settings` key `telegram_mention_forward`, JSON `{chatId, topicId}`):
   - `getMentionForwardSettings(db)` / `setMentionForwardSettings(db, {chatId, topicId})`
     в `backend/src/telegram/settings.js`.
   - Роуты `GET/PUT /api/telegram/mention-forward`.
   - Пока chatId+topicId не заданы — функция выключена (обработчик молча пропускает).

2. **Хук готовности клиента** (`backend/src/telegram/userbot/client.js`):
   `onUserbotClientReady(fn)` — колбэки выполняются после connect при каждом
   создании клиента (включая пересоздание после re-login).

3. **Обработчик** (`backend/src/telegram/userbot/mention-forward.js`):
   - `normalizePeerChatId(peerId)` — PeerChannel → `-100<id>`, PeerChat → `-<id>`, PeerUser → null.
   - `shouldForwardMention({message, sourceChatId, settings})` — чистый фильтр:
     настройки заданы, `message.mentioned === true`, источник — группа, источник ≠ целевой чат.
   - `forwardMentionMessage({client, db, message})` — контекстное сообщение
     «Упоминание в „{title}“ от {имя} @{username}» (title из `telegram_chats`,
     отправитель через `message.getSender()`), затем `Api.messages.ForwardMessages`
     с `topMsgId` топика.
   - `initMentionForwarding()` — регистрирует `NewMessage({incoming: true})`-обработчик
     через хук готовности; ошибки логируются и не роняют обработчик.
   - Вызов из `index.js` при старте.

4. **UI** (страница Telegram): блок «Пересылка упоминаний» — выбор чата из синкнутых
   и топика из `telegram_topics` (топик «Упоминания» создаётся в Telegram вручную,
   reconcile его подхватывает), кнопка «Сохранить».

## Ограничения

- Сообщения, пришедшие пока бэкенд лежал, не догоняются (принято).
- Форвард сохраняет автора; исходный чат виден из контекстного сообщения.

## Тесты

- `shouldForwardMention`: все ветки фильтра.
- `forwardMentionMessage`: мок клиента — проверка sendMessage (текст, replyTo)
  и ForwardMessages (fromPeer, id, topMsgId); пропуск при выключенных настройках.
- `normalizePeerChatId`: каналы/группы/пользователи.
- Роуты mention-forward: GET/PUT, валидация.
