const CRM_TIMEZONE = process.env.CRM_TIMEZONE || 'Europe/Moscow';

/** Offset suffix for CRM calendar API (Moscow has no DST since 2011). */
function crmOffsetSuffix() {
  if (CRM_TIMEZONE === 'Europe/Moscow') return '+03:00';
  return '+00:00';
}

/** Format dates the same way FullCalendar sends them (moment.format() → ISO8601 with offset). */
export function formatCrmDateTime(date) {
  const d = new Date(date);
  const local = d.toLocaleString('sv-SE', { timeZone: CRM_TIMEZONE }).replace(' ', 'T');
  return `${local}${crmOffsetSuffix()}`;
}

/** Calendar date parts in CRM timezone (for month boundaries in Docker UTC). */
export function getCrmCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Default parse window: start of current month → end of next month (Moscow TZ). */
export function getDefaultParseRange(now = new Date()) {
  const { year, month } = getCrmCalendarDate(now);
  const start = new Date(year, month - 1, 1, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59);
  return {
    start: formatCrmDateTime(start),
    end: formatCrmDateTime(end),
  };
}

export function parseEventDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isEventInRange(event, startDate, endDate) {
  const eventStart = parseEventDate(event.start ?? event.start_date);
  if (!eventStart) return true;

  const rangeStart = parseEventDate(startDate)?.getTime() ?? -Infinity;
  const rangeEnd = parseEventDate(endDate)?.getTime() ?? Infinity;
  const t = eventStart.getTime();
  return t >= rangeStart && t <= rangeEnd;
}
