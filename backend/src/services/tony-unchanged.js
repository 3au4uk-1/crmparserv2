export function shouldSkipTonyFullFetch({ probeEnabled, probe, existingStamp, dataSource }) {
  if (!probeEnabled) return false;
  if (!probe?.ok || probe.notFound || probe.deleted) return false;
  if (dataSource !== 'tony') return false;
  if (!existingStamp || !probe.updatedAt) return false;
  return existingStamp === probe.updatedAt;
}

export function loadTonyUpdatedAtMap(db) {
  const rows = db.prepare(`
    SELECT tony_order_id, tony_updated_at, data_source
    FROM deals
    WHERE data_source = 'tony'
      AND tony_order_id IS NOT NULL
      AND tony_order_id != ''
      AND tony_updated_at IS NOT NULL
      AND tony_updated_at != ''
  `).all();
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.tony_order_id), {
      stamp: String(row.tony_updated_at),
      dataSource: row.data_source,
    });
  }
  return map;
}
