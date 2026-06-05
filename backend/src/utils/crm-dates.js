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

/** Start of today in CRM timezone (no past deals). */
export function getMinParseStart(now = new Date()) {
  const { year, month, day } = getCrmCalendarDate(now);
  const start = new Date(year, month - 1, day, 0, 0, 0);
  return formatCrmDateTime(start);
}

/** Default parse window: today → end of next month (Moscow TZ). */
export function getDefaultParseRange(now = new Date()) {
  const { year, month } = getCrmCalendarDate(now);
  const start = getMinParseStart(now);
  const end = new Date(year, month + 1, 0, 23, 59, 59);
  return {
    start,
    end: formatCrmDateTime(end),
    startDate: toInputDate(start),
    endDate: toInputDate(formatCrmDateTime(end)),
  };
}

/** YYYY-MM-DD for HTML date inputs. */
export function toInputDate(value) {
  const parsed = parseEventDate(value);
  if (!parsed) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize UI/API dates and never parse before today. */
export function normalizeParseRange(startDate, endDate, now = new Date()) {
  const defaults = getDefaultParseRange(now);
  let start = startDate || defaults.start;
  let end = endDate || defaults.end;

  if (DATE_INPUT_RE.test(start)) {
    start = `${start}T00:00:00${crmOffsetSuffix()}`;
  }
  if (DATE_INPUT_RE.test(end)) {
    end = `${end}T23:59:59${crmOffsetSuffix()}`;
  }

  const minStart = getMinParseStart(now);
  const minTs = parseEventDate(minStart)?.getTime() ?? -Infinity;
  const startTs = parseEventDate(start)?.getTime() ?? minTs;
  if (startTs < minTs) {
    start = minStart;
  }

  const endTs = parseEventDate(end)?.getTime() ?? Infinity;
  if (endTs < minTs) {
    end = `${toInputDate(minStart)}T23:59:59${crmOffsetSuffix()}`;
  }

  return { start, end };
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
