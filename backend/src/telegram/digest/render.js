import { sliceRisksForMessage } from './compute.js';

export function formatCompactRub(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    const s = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '');
    return `₽${s}М`;
  }
  if (v >= 1000) {
    const k = Math.round(v / 1000);
    return `₽${k}к`;
  }
  return `₽${Math.round(v)}`;
}

export function formatRiskTitle(risk) {
  const parts = [risk.companyName, risk.manager, risk.bookingNo]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join('/');
  return String(risk.name || risk.opportunityId || '—').trim();
}

export function renderDigestMessage(model, { title, dateLabel }) {
  const lines = [
    `${title} ${dateLabel} · ${model.totalDeals} сделок / ${model.totalPositions} позиций`,
    `✔️ ${model.ready.deals} сделок / ${model.ready.positions} позиций · ${formatCompactRub(model.ready.amountRubles)}`,
    `❌ ${model.notReady.deals} сделок / ${model.notReady.positions} позиций · ${formatCompactRub(model.notReady.amountRubles)}`,
    '',
    '⚠ РИСКИ:',
  ];
  const { shown, hiddenCount } = sliceRisksForMessage(model.risks);
  if (!shown.length) {
    lines.push('нет');
  } else {
    for (const r of shown) {
      lines.push(
        `• ${formatRiskTitle(r)} · ${r.ready}/${r.total} · ${formatCompactRub(r.amountRubles)} · ${r.labels.join(' · ')}`,
      );
    }
    if (hiddenCount > 0) lines.push(`… +${hiddenCount}`);
  }
  return lines.join('\n');
}
