export const CRM_TIMEZONE = process.env.CRM_TIMEZONE || 'Europe/Moscow';

/** Offset suffix for CRM calendar API (Moscow has no DST since 2011). */
export function crmOffsetSuffix() {
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

/** Default parse window: today → 2 weeks ahead (Moscow TZ). */
export function getDefaultParseRange(now = new Date()) {
  const { year, month, day } = getCrmCalendarDate(now);
  const start = getMinParseStart(now);
  const end = new Date(year, month - 1, day + 14, 23, 59, 59);
  return {
    start,
    end: formatCrmDateTime(end),
    startDate: toInputDate(start),
    endDate: toInputDate(formatCrmDateTime(end)),
  };
}

const TIER_DAY_OFFSET = {
  'weekday-fast': 7,
  'weekday-deep': 14,
  'night-light': 4,
  weekend: 7,
};

/** Parse window for a schedule tier: today → today+N days (CRM timezone). */
export function getParseRangeForTier(tier, now = new Date()) {
  const dayOffset = TIER_DAY_OFFSET[tier];
  if (dayOffset == null) {
    throw new Error(`Unknown parse tier: ${tier}`);
  }
  const { year, month, day } = getCrmCalendarDate(now);
  const start = getMinParseStart(now);
  const end = new Date(year, month - 1, day + dayOffset, 23, 59, 59);
  const endFormatted = formatCrmDateTime(end);
  return {
    start,
    end: endFormatted,
    startDate: toInputDate(start),
    endDate: toInputDate(endFormatted),
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

/** Manual parse only: no min-date clamp; validates from <= to. */
export function normalizeManualParseRange(startDate, endDate, now = new Date()) {
  const defaults = getDefaultParseRange(now);
  let start = startDate || defaults.start;
  let end = endDate || defaults.end;

  if (DATE_INPUT_RE.test(start)) {
    start = `${start}T00:00:00${crmOffsetSuffix()}`;
  }
  if (DATE_INPUT_RE.test(end)) {
    end = `${end}T23:59:59${crmOffsetSuffix()}`;
  }

  const startTs = parseEventDate(start)?.getTime() ?? 0;
  const endTs = parseEventDate(end)?.getTime() ?? 0;
  if (startTs > endTs) {
    throw new Error('from must be <= to');
  }

  return { start, end };
}

export function normalizeExportRange(startDate, endDate, now = new Date()) {
  if (!DATE_INPUT_RE.test(startDate) || !DATE_INPUT_RE.test(endDate)) {
    throw new Error('from and to required (YYYY-MM-DD)');
  }
  const start = `${startDate}T00:00:00${crmOffsetSuffix()}`;
  const end = `${endDate}T23:59:59${crmOffsetSuffix()}`;
  const startTs = parseEventDate(start)?.getTime() ?? 0;
  const endTs = parseEventDate(end)?.getTime() ?? 0;
  if (startTs > endTs) {
    throw new Error('from must be <= to');
  }
  return { start, end, startDate, endDate };
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

const ARRIVAL_TIME_RE = /^(\d{1,2}):(\d{2})$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function calendarPartsFromDeal(deal) {
  const raw = deal.start_date || deal.end_date;
  if (!raw) return null;
  const parsed = parseEventDate(raw);
  if (!parsed) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function buildCloseDate(deal) {
  const parts = calendarPartsFromDeal(deal);
  if (!parts) return new Date().toISOString();

  const { year, month, day } = parts;
  let hour = 0;
  let minute = 0;

  const match = deal.arrival_time?.trim().match(ARRIVAL_TIME_RE);
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      hour = 0;
      minute = 0;
    }
  }

  return `${year}-${month}-${day}T${pad2(hour)}:${pad2(minute)}:00${crmOffsetSuffix()}`;
}
