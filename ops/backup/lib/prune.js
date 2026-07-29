import { buildSnapshotId } from './snapshot-id.js';

/** @param {string} prefix e.g. full-snapshots/20260720T010000Z/ */
export function parseSnapshotTimeFromPrefix(prefix) {
  const m = prefix.match(/full-snapshots\/(\d{8}T\d{6}Z)\//);
  if (!m) return null;
  const s = m[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function listExpiredSnapshotPrefixes(prefixes, now = new Date(), retentionDays = 7) {
  const cutoff = new Date(now.getTime() - (retentionDays + 1) * 24 * 60 * 60 * 1000);
  return prefixes.filter((p) => {
    const t = parseSnapshotTimeFromPrefix(p);
    return t != null && t < cutoff;
  });
}

// re-export for tests that want id format compatibility
export { buildSnapshotId };
