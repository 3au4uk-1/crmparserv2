export function buildOverrideMap(existingItems) {
  const map = {};
  for (const item of existingItems) {
    if (item.sync_override || item.twenty_id || item.amount_locked) {
      map[item.name] = {
        sync_override: item.sync_override ?? null,
        twenty_id: item.twenty_id ?? null,
        amount_locked: item.amount_locked ? 1 : 0,
        sum: item.amount_locked ? item.sum : undefined,
        price: item.amount_locked ? item.price : undefined,
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

  const restoreLocked = db.prepare(`
    UPDATE deal_items
    SET sync_override = ?, twenty_id = ?, amount_locked = ?, sum = ?, price = ?
    WHERE id = ?
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
      if (preserved.amount_locked) {
        restoreLocked.run(
          preserved.sync_override,
          preserved.twenty_id,
          preserved.amount_locked,
          preserved.sum,
          preserved.price,
          result.lastInsertRowid
        );
      } else {
        restore.run(preserved.sync_override, preserved.twenty_id, result.lastInsertRowid);
      }
    }
  }
}
