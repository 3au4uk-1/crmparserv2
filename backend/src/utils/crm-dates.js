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

/** Default parse window: previous month → end of next month (covers visible calendar range). */
export function getDefaultParseRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
  return {
    start: formatCrmDateTime(start),
    end: formatCrmDateTime(end),
  };
}
