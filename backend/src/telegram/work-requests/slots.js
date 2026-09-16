import { chatIdsMatch, normalizeTelegramChatId } from '../chat-id.js';
import { TOPIC_ROLES } from './parse-form.js';

export const WORK_REQUEST_SLOTS_KEY = 'telegram_work_request_slots';

const VALID_TOPIC_ROLES = new Set(Object.values(TOPIC_ROLES));
const MAX_SLOTS = 9;

function slotKey({ chatId, threadId }) {
  return `${chatId}#${threadId}`;
}

export function normalizeSlot(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const chatId = normalizeTelegramChatId(raw.chatId);
  if (!chatId) return null;

  const threadId = Number(raw.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) return null;

  const topicRole = raw.topicRole;
  if (!VALID_TOPIC_ROLES.has(topicRole)) return null;

  const companyLabel = String(raw.companyLabel ?? '').trim();

  return { chatId, threadId, companyLabel, topicRole };
}

function validateSlot(raw) {
  const topicRole = raw?.topicRole;
  if (!VALID_TOPIC_ROLES.has(topicRole)) {
    throw Object.assign(new Error('Invalid topicRole'), { status: 400 });
  }

  const threadId = Number(raw?.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw Object.assign(new Error('threadId must be a positive integer'), { status: 400 });
  }

  const chatId = normalizeTelegramChatId(raw?.chatId);
  const companyLabel = String(raw?.companyLabel ?? '').trim();

  return { chatId, threadId, companyLabel, topicRole };
}

function dedupeSlots(slots) {
  const seen = new Set();
  const result = [];
  for (const slot of slots) {
    const key = slotKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(slot);
    if (result.length >= MAX_SLOTS) break;
  }
  return result;
}

function readRawSlots(db) {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(WORK_REQUEST_SLOTS_KEY);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getWorkRequestSlots(db) {
  const normalized = readRawSlots(db)
    .map(normalizeSlot)
    .filter(Boolean);
  return dedupeSlots(normalized);
}

export function setWorkRequestSlots(db, slots) {
  const validated = (slots ?? [])
    .filter((raw) => String(raw?.chatId ?? '').trim())
    .filter((raw) => Number.isInteger(Number(raw?.threadId)) && Number(raw.threadId) > 0)
    .map(validateSlot);
  const unique = dedupeSlots(validated);

  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
  ).run(WORK_REQUEST_SLOTS_KEY, JSON.stringify(unique));

  return unique;
}

export function findSlot(db, chatId, threadId) {
  const normalizedThreadId = Number(threadId);
  return getWorkRequestSlots(db).find(
    (slot) => chatIdsMatch(slot.chatId, chatId) && slot.threadId === normalizedThreadId,
  ) ?? null;
}
