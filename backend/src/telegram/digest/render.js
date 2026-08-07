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

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export function formatRiskTitle(risk) {
  const booking = String(risk.bookingNo || '').trim();
  if (booking) return booking;
  const name = String(risk.name || '').trim();
  if (name) return name;
  return '—';
}

export function formatRiskLinkLine(risk) {
  const parts = [];
  if (risk.twentyUrl) {
    parts.push(`<a href="${escapeHtmlAttr(risk.twentyUrl)}">Twenty</a>`);
  }
  if (risk.tonyUrl) {
    parts.push(`<a href="${escapeHtmlAttr(risk.tonyUrl)}">Tony</a>`);
  }
  if (risk.bitrixUrl) {
    parts.push(`<a href="${escapeHtmlAttr(risk.bitrixUrl)}">Bitrix</a>`);
  }
  if (!parts.length) return '';
  return `(${parts.join(' | ')})`;
}

export function renderDigestMessage(
  model,
  { title, dateLabel, notes, risksOverride },
) {
  const lines = [
    `${title} ${dateLabel} · ${model.totalDeals} сделок / ${model.totalPositions} позиций`,
    `✔️ ${model.ready.deals} сделок / ${model.ready.positions} позиций · ${formatCompactRub(model.ready.amountRubles)}`,
    `❌ ${model.notReady.deals} сделок / ${model.notReady.positions} позиций · ${formatCompactRub(model.notReady.amountRubles)}`,
    '',
    '⚠ РИСКИ:',
  ];
  const { shown, hiddenCount } = sliceRisksForMessage(
    risksOverride ?? model.risks,
  );
  if (!shown.length) {
    lines.push('нет');
  } else {
    for (const r of shown) {
      let line = `• ${escapeHtml(formatRiskTitle(r))} · ${r.ready}/${r.total} · ${escapeHtml(formatCompactRub(r.amountRubles))} · ${escapeHtml(r.labels.join(' · '))}`;
      if (r.reason) line += ` · ${escapeHtml(r.reason)}`;
      lines.push(line);
      const links = formatRiskLinkLine(r);
      if (links) lines.push(links);
    }
    if (hiddenCount > 0) lines.push(`… +${hiddenCount}`);
  }
  if (notes?.length) {
    lines.push('');
    lines.push('🧠');
    for (const note of notes) lines.push(note);
  }
  return lines.join('\n');
}
