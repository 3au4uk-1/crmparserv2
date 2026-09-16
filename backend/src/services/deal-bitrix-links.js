const BITRIX_URL = (id) => `https://prointeractive.bitrix24.ru/crm/deal/details/${id}/?any`;

export function inferBitrixLinkRole({ eventTitle, paymentAmount }) {
  if (Number(paymentAmount) > 0) return 'payment';
  if (/оплат/i.test(String(eventTitle || ''))) return 'payment';
  return 'booking';
}

export function upsertDealBitrixLink(db, { dealId, bitrixId, role, isCanonical }) {
  const id = String(bitrixId).trim();
  const existing = db.prepare(
    'SELECT id, is_canonical FROM deal_bitrix_links WHERE deal_id = ? AND bitrix_id = ?',
  ).get(dealId, id);
  if (!existing) {
    const hasCanonical = db.prepare(
      'SELECT 1 FROM deal_bitrix_links WHERE deal_id = ? AND is_canonical = 1',
    ).get(dealId);
    const canonical = isCanonical === true || (!hasCanonical && isCanonical !== false) ? 1 : 0;
    db.prepare(`
      INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical)
      VALUES (?, ?, ?, ?)
    `).run(dealId, id, role, canonical);
    return;
  }
  db.prepare('UPDATE deal_bitrix_links SET role = ? WHERE id = ?').run(role, existing.id);
}

export function listDealBitrixLinks(db, dealId) {
  return db.prepare(
    'SELECT bitrix_id AS bitrixId, role, is_canonical AS isCanonical FROM deal_bitrix_links WHERE deal_id = ? ORDER BY id',
  ).all(dealId).map((r) => ({ ...r, isCanonical: Boolean(r.isCanonical) }));
}

export function mirrorCanonicalCrmLeadId(db, dealId) {
  const row = db.prepare(
    'SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? AND is_canonical = 1',
  ).get(dealId);
  if (!row) return;
  db.prepare('UPDATE deals SET crm_lead_id = ? WHERE id = ?').run(row.bitrix_id, dealId);
}

export function buildBitrixLinkInput(links) {
  const canonical = links.find((l) => l.isCanonical) || links[0];
  if (!canonical) return null;
  return {
    primaryLinkUrl: BITRIX_URL(canonical.bitrixId),
    primaryLinkLabel: `Bitrix #${canonical.bitrixId}`,
    secondaryLinks: links
      .filter((l) => l.bitrixId !== canonical.bitrixId)
      .map((l) => ({ url: BITRIX_URL(l.bitrixId), label: `Bitrix #${l.bitrixId}` })),
  };
}
