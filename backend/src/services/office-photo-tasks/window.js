import { toInputDate } from '../../utils/crm-dates.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** CRM calendar day as YYYY-MM-DD. */
export function calendarYmd(now = new Date()) {
  return toInputDate(now);
}

/** Add calendar days to YYYY-MM-DD (CRM calendar, no TZ drift). */
export function shiftYmd(ymd, deltaDays) {
  const [year, month, day] = ymd.split('-').map(Number);
  const next = new Date(year, month - 1, day + deltaDays);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}
