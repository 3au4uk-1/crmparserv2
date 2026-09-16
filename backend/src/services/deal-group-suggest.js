import { extractBookingNumbers } from './booking-numbers.js';

const COMPANY_CODES = new Set(['ПРО', 'АРТ', 'АРЕНДА', 'БС']);
const DATE_PATTERNS = [
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}\.\d{1,2}(?:\.\d{2,4})?/g,
  /\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*/gi,
];
const BOOKING_RE = /\b\d{5,7}\b/g;
const TOKEN_RE = /[\p{L}\p{N}]+/gu;
const MIN_SOFT_TOKEN_LEN = 2;

function normalizeToken(token) {
  return token.toLowerCase().replace(/ё/g, 'е');
}

/** Drop company codes, dates, and booking numbers; return normalized tokens length ≥ 2. */
export function extractSoftTokens(title) {
  if (!title) return [];

  let s = String(title);
  for (const code of COMPANY_CODES) {
    s = s.replace(new RegExp(`\\b${code}\\b`, 'gi'), ' ');
  }
  for (const re of DATE_PATTERNS) {
    s = s.replace(re, ' ');
  }
  s = s.replace(BOOKING_RE, ' ');

  const seen = new Set();
  const tokens = [];
  let m;
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  while ((m = re.exec(s)) !== null) {
    const t = normalizeToken(m[0]);
    if (t.length < MIN_SOFT_TOKEN_LEN) continue;
    if (COMPANY_CODES.has(t.toUpperCase())) continue;
    if (!seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }
  return tokens;
}

export function datesWithinWindow(a, b, days = 2) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  const diffMs = Math.abs(da.getTime() - db.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

function dealDate(deal) {
  return deal.load_date || deal.start_date || null;
}

function normalizeDeal(deal) {
  const bookingNumbers =
    deal.bookingNumbers?.length > 0
      ? [...deal.bookingNumbers]
      : extractBookingNumbers(deal.title);
  const bitrixIds = deal.bitrixIds?.length > 0 ? [...deal.bitrixIds] : [];
  return { ...deal, bookingNumbers, bitrixIds };
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(id) {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root);
    }
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  clusters() {
    const groups = new Map();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(id);
    }
    return [...groups.values()];
  }
}

const REASON_PRIORITY = { multi_booking_title: 2, shared_booking: 1 };

function buildHardCandidates(deals) {
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const raw = [];

  const byBooking = new Map();
  for (const deal of deals) {
    for (const bn of deal.bookingNumbers) {
      if (!byBooking.has(bn)) byBooking.set(bn, new Set());
      byBooking.get(bn).add(deal.id);
    }
  }
  for (const ids of byBooking.values()) {
    if (ids.size < 2) continue;
    raw.push({
      dealIds: [...ids].sort((a, b) => a - b),
      reason: 'shared_booking',
    });
  }

  const byBitrix = new Map();
  for (const deal of deals) {
    for (const bitrixId of deal.bitrixIds) {
      if (!byBitrix.has(bitrixId)) byBitrix.set(bitrixId, new Set());
      byBitrix.get(bitrixId).add(deal.id);
    }
  }
  for (const ids of byBitrix.values()) {
    if (ids.size < 2) continue;
    const members = [...ids].map((id) => dealById.get(id));
    const bookings = new Set(members.flatMap((d) => d.bookingNumbers));
    if (bookings.size < 2) continue;
    raw.push({
      dealIds: [...ids].sort((a, b) => a - b),
      reason: 'multi_booking_title',
    });
  }

  const byDealIds = new Map();
  for (const cand of raw) {
    const key = cand.dealIds.join(',');
    const existing = byDealIds.get(key);
    if (
      !existing ||
      REASON_PRIORITY[cand.reason] > REASON_PRIORITY[existing.reason]
    ) {
      byDealIds.set(key, cand);
    }
  }
  const deduped = [...byDealIds.values()];

  const dealToCandidates = new Map();
  for (const cand of deduped) {
    for (const id of cand.dealIds) {
      if (!dealToCandidates.has(id)) dealToCandidates.set(id, []);
      dealToCandidates.get(id).push(cand);
    }
  }

  const conflictIds = new Set(
    [...dealToCandidates.entries()]
      .filter(([, cands]) => cands.length > 1)
      .map(([id]) => id)
  );

  if (conflictIds.size === 0) return deduped;

  return deduped.map((cand) =>
    cand.dealIds.some((id) => conflictIds.has(id))
      ? { ...cand, conflict: true }
      : cand
  );
}

function sharedSoftTokens(a, b) {
  const setB = new Set(extractSoftTokens(b.title));
  return extractSoftTokens(a.title).filter((t) => setB.has(t));
}

function buildSoftCandidates(deals, hardDealIds) {
  const eligible = deals.filter((d) => !hardDealIds.has(d.id));
  if (eligible.length < 2) return [];

  const uf = new UnionFind(eligible.map((d) => d.id));
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (a.manager_name !== b.manager_name) continue;
      if (!datesWithinWindow(dealDate(a), dealDate(b))) continue;
      if (sharedSoftTokens(a, b).length === 0) continue;
      uf.union(a.id, b.id);
    }
  }

  return uf
    .clusters()
    .filter((ids) => ids.length >= 2)
    .map((ids) => ({
      dealIds: [...ids].sort((a, b) => a - b),
      reason: 'soft_marker',
    }));
}

/** Pure suggestion — never writes deal_groups. */
export function suggestDealGroups(deals) {
  const eligible = deals.filter((d) => d.groupId == null).map(normalizeDeal);
  const hard = buildHardCandidates(eligible);
  const hardDealIds = new Set(hard.flatMap((c) => c.dealIds));
  const soft = buildSoftCandidates(eligible, hardDealIds);
  return { hard, soft };
}
