import crypto from 'crypto';
import { crmOffsetSuffix } from '../utils/crm-dates.js';
import { parseQuantityNum } from './twenty-opportunity.js';

const DMY_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const FREE_ENTRY_RE = /свободная запись/i;

export function normalizeFreeEntryItem(item) {
  if (!FREE_ENTRY_RE.test(item.name ?? '')) {
    return item;
  }
  const trimmedComment = (item.comment ?? '').trim();
  if (trimmedComment) {
    return { ...item, name: trimmedComment, comment: '' };
  }
  return { ...item, comment: '' };
}

/** "16.06.2026" -> "2026-06-16" (or '' when not parseable). */
export function dmyToIsoDate(value) {
  const m = (value || '').trim().match(DMY_RE);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** "16.06.2026" -> "2026-06-16T00:00:00+03:00" (or '' when not parseable). */
function dmyToIsoDateTime(value) {
  const iso = dmyToIsoDate(value);
  return iso ? `${iso}T00:00:00${crmOffsetSuffix()}` : '';
}

export function buildTonyDealFields(parsed) {
  const d = parsed.dates;
  const dismantle = [d.deinstallDate, d.deinstallTime].filter(Boolean).join(' ').trim();
  const work = [d.workTimeBegin, d.workTimeEnd].filter(Boolean).join('-');
  return {
    load_date: dmyToIsoDate(d.loadDate),
    load_time: d.loadTime || '',
    start_date: dmyToIsoDateTime(d.eventBegin) || null,
    end_date: dmyToIsoDateTime(d.eventEnd) || null,
    arrival_time: d.loadTime || null,
    dismantle_time: dismantle || null,
    work_time: work || null,
    address: parsed.address || '',
    budget: parsed.budget || 0,
  };
}

export function disambiguateDuplicateNames(items) {
  const seen = new Map(); // trimmedName -> count seen so far
  return items.map((item) => {
    const base = String(item.name ?? '').trim();
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n === 1) return item;
    return { ...item, name: `${base} (#${n})` };
  });
}

export function buildTonyItems(parsed) {
  const normalized = parsed.items.map((i) =>
    normalizeFreeEntryItem({
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      discount: i.discount ?? 0,
      sum: i.sum,
      comment: i.comment ?? '',
      quantity_num: parseQuantityNum(i.quantity),
    }),
  );
  return disambiguateDuplicateNames(normalized);
}

export function tonyContentHash(parsed) {
  const snapshot = JSON.stringify({
    items: parsed.items.map((i) => [
      i.name,
      i.price,
      i.quantity,
      i.discount,
      i.category,
      i.sum,
      i.comment ?? '',
    ]),
    dates: parsed.dates,
    address: parsed.address,
    budget: parsed.budget,
  });
  return crypto.createHash('sha256').update(snapshot).digest('hex');
}
