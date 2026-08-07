import {
  formatCrmDateTime,
  getCrmCalendarDate,
} from '../../utils/crm-dates.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Add calendar days to YYYY-MM-DD (CRM calendar, no TZ drift). */
export function addCalendarDays(inputDateYmd, days) {
  const [year, month, day] = inputDateYmd.split('-').map(Number);
  const next = new Date(year, month - 1, day + days);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}

function crmTodayYmd(now) {
  const { year, month, day } = getCrmCalendarDate(now);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dayBounds(inputDateYmd) {
  const [year, month, day] = inputDateYmd.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0);
  const endExclusive = new Date(year, month - 1, day + 1, 0, 0, 0);
  return {
    gte: formatCrmDateTime(start),
    lt: formatCrmDateTime(endExclusive),
  };
}

function formatDateLabel(inputDateYmd) {
  const [, month, day] = inputDateYmd.split('-');
  return `${day}.${month}`;
}

const TITLE_BY_OFFSET = {
  1: 'ЗАВТРА',
  2: 'ПОСЛЕЗАВТРА',
};

/** Digest day metadata for offset from CRM today (1 = tomorrow). */
export function getDigestDayMeta(offsetDays, now = new Date()) {
  const inputDate = addCalendarDays(crmTodayYmd(now), offsetDays);
  const title = TITLE_BY_OFFSET[offsetDays] ?? '';
  const dateLabel = formatDateLabel(inputDate);
  const { gte, lt } = dayBounds(inputDate);
  return { inputDate, title, dateLabel, gte, lt };
}
