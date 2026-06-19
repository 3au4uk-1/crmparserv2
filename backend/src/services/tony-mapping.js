import crypto from 'crypto';
import { crmOffsetSuffix } from '../utils/crm-dates.js';

const DMY_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

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

export function buildTonyItems(parsed) {
  return parsed.items.map((i) => ({
    name: i.name,
    price: i.price,
    quantity: i.quantity,
    discount: i.discount ?? 0,
  }));
}

export function tonyContentHash(parsed) {
  const snapshot = JSON.stringify({
    items: parsed.items.map((i) => [i.name, i.price, i.quantity, i.discount, i.category]),
    dates: parsed.dates,
    address: parsed.address,
    budget: parsed.budget,
  });
  return crypto.createHash('sha256').update(snapshot).digest('hex');
}
