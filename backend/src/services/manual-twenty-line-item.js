export const MANUAL_TWENTY_CLASSIFICATION = 'manual_twenty';

export function findDealByTwentyOpportunityId(db, opportunityId) {
  const deal = db.prepare('SELECT * FROM deals WHERE twenty_id = ?').get(opportunityId);
  if (!deal) {
    const err = new Error('Deal not found in parser');
    err.status = 404;
    throw err;
  }
  return deal;
}

function amountMicrosToRubles(amountMicros) {
  return Math.round((Number(amountMicros) || 0) / 1_000_000);
}

export function upsertManualTwentyLineItem(db, twentyLineItemId, payload) {
  const deal = findDealByTwentyOpportunityId(db, payload.opportunityId);
  const qty = Number(payload.kolichestvo) > 0 ? Number(payload.kolichestvo) : 1;
  const totalRub = amountMicrosToRubles(payload.amountMicros);
  const unitPrice = qty > 0 ? totalRub / qty : 0;

  const existing = db
    .prepare('SELECT * FROM deal_items WHERE twenty_id = ?')
    .get(twentyLineItemId);

  if (existing) {
    db.prepare(`
      UPDATE deal_items
      SET name = ?, price = ?, quantity = ?, quantity_num = ?, sum = ?,
          classification = ?, sync_override = 'include'
      WHERE id = ?
    `).run(
      payload.name,
      unitPrice,
      String(qty),
      qty,
      totalRub,
      MANUAL_TWENTY_CLASSIFICATION,
      existing.id,
    );
    return { dealItemId: existing.id };
  }

  const result = db.prepare(`
    INSERT INTO deal_items (
      deal_id, name, price, quantity, quantity_num, sum,
      classification, sync_override, twenty_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'include', ?)
  `).run(
    deal.id,
    payload.name,
    unitPrice,
    String(qty),
    qty,
    totalRub,
    MANUAL_TWENTY_CLASSIFICATION,
    twentyLineItemId,
  );

  return { dealItemId: result.lastInsertRowid };
}

export function archiveManualTwentyLineItem(db, twentyLineItemId) {
  const existing = db.prepare('SELECT id FROM deal_items WHERE twenty_id = ?').get(twentyLineItemId);
  if (!existing) {
    const err = new Error('Line item not found in parser');
    err.status = 404;
    throw err;
  }
  db.prepare(`UPDATE deal_items SET sync_override = 'exclude' WHERE twenty_id = ?`).run(twentyLineItemId);
  return { success: true };
}
