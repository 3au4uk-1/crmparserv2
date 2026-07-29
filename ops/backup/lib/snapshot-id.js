export function buildSnapshotId(date = new Date()) {
  const iso = date.toISOString(); // 2026-07-29T15:30:45.123Z
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
