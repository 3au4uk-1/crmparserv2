import { parseDealNameParts } from './label.js';

export const R1_MIN_RUBLES = 150_000;
export const RISK_PCT_LT = 0.3;
export const RISK_LIST_LIMIT = 7;

export function amountRubles(amount) {
  if (amount == null || amount.amountMicros == null) return 0;
  const n = Number(amount.amountMicros) / 1_000_000;
  return Number.isFinite(n) ? n : 0;
}

function activeItems(items) {
  return (items ?? []).filter((i) => i.stage && i.stage !== 'OTMENA');
}

function readiness(items) {
  const active = activeItems(items);
  const total = active.length;
  const ready = active.filter((i) => i.stage === 'GOTOVO').length;
  const pct = total === 0 ? 1 : ready / total;
  return { total, ready, pct };
}

function topQuarterThreshold(amounts) {
  if (!amounts.length) return Infinity;
  const sorted = [...amounts].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function buildDigestModel({ deals, lineItemsByOppId }) {
  const activeDeals = (deals ?? []).filter((d) => d.stage && d.stage !== 'OTMENA');
  const readyDeals = [];
  const notReadyDeals = [];
  for (const d of activeDeals) {
    if (d.stage === 'GOTOVO') readyDeals.push(d);
    else notReadyDeals.push(d);
  }

  const sumGroup = (group) => {
    let positions = 0;
    let amount = 0;
    for (const d of group) {
      positions += readiness(lineItemsByOppId[d.id]).total;
      amount += amountRubles(d.amount);
    }
    return { deals: group.length, positions, amountRubles: amount };
  };

  const ready = sumGroup(readyDeals);
  const notReady = sumGroup(notReadyDeals);
  const notReadyAmounts = notReadyDeals.map((d) => amountRubles(d.amount));
  const q75 = topQuarterThreshold(notReadyAmounts);

  const risks = [];
  for (const d of notReadyDeals) {
    const { total, ready: rdy, pct } = readiness(lineItemsByOppId[d.id]);
    if (total === 0) continue;
    const amount = amountRubles(d.amount);
    const labels = [];
    let score = 0;
    const r0 = total >= 2 && pct < RISK_PCT_LT;
    const r1 = amount >= R1_MIN_RUBLES && pct < 1;
    const r2 = rdy === 0 && total >= 2;
    if (r0) {
      labels.push('риск');
      score += 3;
    }
    if (r2) {
      labels.push('0 готово');
      score += 2;
    }
    if (amount >= q75 && notReadyAmounts.length > 0) score += 2;
    if (r1) {
      labels.push('крупный готов не полностью');
      score += 1;
    }
    if (!r0 && !r1 && !r2) continue;
    const parsed = parseDealNameParts(d.name);
    risks.push({
      opportunityId: d.id,
      companyName: d.companyName || '',
      manager: parsed.manager,
      bookingNo: parsed.bookingNo,
      name: d.name || '',
      ready: rdy,
      total,
      amountRubles: amount,
      labels,
      score,
    });
  }

  risks.sort((a, b) => b.score - a.score || b.amountRubles - a.amountRubles);

  return {
    totalDeals: activeDeals.length,
    totalPositions: ready.positions + notReady.positions,
    ready,
    notReady,
    risks,
  };
}

export function sliceRisksForMessage(risks, limit = RISK_LIST_LIMIT) {
  const shown = risks.slice(0, limit);
  return { shown, hiddenCount: Math.max(0, risks.length - shown.length) };
}
