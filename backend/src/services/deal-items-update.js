export function buildOverrideMap(existingItems) {
  const map = {};
  for (const item of existingItems) {
    if (item.sync_override || item.twenty_id) {
      map[item.name] = {
        sync_override: item.sync_override ?? null,
        twenty_id: item.twenty_id ?? null,
      };
    }
  }
  return map;
}

export function replaceDealItemsPreservingOverrides(db, dealId, classifiedItems, overrideMap) {
  db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(dealId);

  const insert = db.prepare(`
    INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence, comment, sum, quantity_num)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const restore = db.prepare(`
    UPDATE deal_items SET sync_override = ?, twenty_id = ? WHERE id = ?
  `);

  for (const item of classifiedItems) {
    const result = insert.run(
      dealId,
      item.name,
      item.price,
      item.quantity,
      item.discount,
      item.classification,
      item.classification_confidence,
      item.comment ?? null,
      item.sum ?? null,
      item.quantity_num ?? null
    );

    const preserved = overrideMap[item.name];
    if (preserved) {
      restore.run(preserved.sync_override, preserved.twenty_id, result.lastInsertRowid);
    }
  }
}
