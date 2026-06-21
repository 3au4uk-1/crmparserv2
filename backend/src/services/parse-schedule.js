import { CRM_TIMEZONE } from '../utils/crm-dates.js';

export const PARSE_TIERS = ['weekday-deep', 'weekend', 'weekday-fast', 'night-light'];

const WEEKEND_SLOTS = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);

const executedSlots = new Set();

function getCrmTimeParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    weekday: get('weekday'),
    hour: Number(get('hour')),
  };
}

function slotKey(tier, now) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const { hour } = getCrmTimeParts(now);
  return `${tier}:${dateParts}:${hour}`;
}

function pickTier(now) {
  const { weekday, hour } = getCrmTimeParts(now);
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  const isWeekend = ['Sat', 'Sun'].includes(weekday);
  const matches = [];

  if (isWeekday && hour === 22) matches.push('weekday-deep');
  if (isWeekend && WEEKEND_SLOTS.has(hour)) matches.push('weekend');
  if (isWeekday && hour >= 9 && hour <= 21) matches.push('weekday-fast');
  if (hour === 2) matches.push('night-light');

  for (const tier of PARSE_TIERS) {
    if (matches.includes(tier)) return tier;
  }
  return null;
}

export function resolveParseTier(now = new Date()) {
  const tier = pickTier(now);
  if (!tier) return null;
  if (executedSlots.has(slotKey(tier, now))) return null;
  return tier;
}

export function markParseSlotExecuted(tier, now = new Date()) {
  executedSlots.add(slotKey(tier, now));
}

export function resetParseScheduleState() {
  executedSlots.clear();
}
