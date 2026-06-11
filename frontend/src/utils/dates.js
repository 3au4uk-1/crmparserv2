const DATE_FMT = { day: '2-digit', month: '2-digit', year: 'numeric' };
const DATETIME_FMT = { ...DATE_FMT, hour: '2-digit', minute: '2-digit' };

/** ISO date (YYYY-MM-DD or datetime) → DD.MM.YYYY */
export function formatDate(value) {
  if (!value) return '';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  if (!y || !m || !d) return String(value).slice(0, 10);
  return `${d}.${m}.${y}`;
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', DATETIME_FMT);
}

export function formatEventDate(date, arrivalTime) {
  const datePart = formatDate(date);
  if (!datePart) return '';
  if (!arrivalTime?.trim()) return datePart;
  return `${datePart} ${arrivalTime.trim()}`;
}
