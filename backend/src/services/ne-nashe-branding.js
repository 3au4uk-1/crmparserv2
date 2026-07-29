import { normalizePattern } from './blacklist.js';

const VALID_MATCH_TYPES = new Set(['exact', 'substring']);

export function matchesNeNasheBrandingEntry(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findNeNasheBrandingMatch(itemName, entries = []) {
  for (const entry of entries) {
    if (matchesNeNasheBrandingEntry(itemName, entry)) return entry;
  }
  return null;
}

export function isNeNasheBrandingItem(itemName, entries = []) {
  return findNeNasheBrandingMatch(itemName, entries) !== null;
}

function mapRow(row) {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.match_type,
    sourceName: row.source_name,
    createdAt: row.created_at,
  };
}

export function loadNeNasheBrandingList(db) {
  return db
    .prepare('SELECT * FROM ne_nashe_branding_items ORDER BY created_at ASC')
    .all()
    .map(mapRow);
}

export function findNeNasheBrandingByPattern(db, pattern, matchType) {
  const normalized = normalizePattern(pattern);
  return db
    .prepare('SELECT * FROM ne_nashe_branding_items WHERE pattern = ? AND match_type = ?')
    .get(normalized, matchType);
}

export function createNeNasheBrandingEntry(db, { pattern, matchType, sourceName = null }) {
  const normalized = normalizePattern(pattern);
  if (!normalized) {
    const err = new Error('pattern is required');
    err.status = 400;
    throw err;
  }
  if (!VALID_MATCH_TYPES.has(matchType)) {
    const err = new Error('matchType must be exact or substring');
    err.status = 400;
    throw err;
  }
  if (findNeNasheBrandingByPattern(db, normalized, matchType)) {
    const err = new Error('Ne-nashe branding entry already exists');
    err.status = 409;
    throw err;
  }

  const result = db
    .prepare(
      'INSERT INTO ne_nashe_branding_items (pattern, match_type, source_name) VALUES (?, ?, ?)'
    )
    .run(normalized, matchType, sourceName);

  return mapRow(
    db.prepare('SELECT * FROM ne_nashe_branding_items WHERE id = ?').get(result.lastInsertRowid)
  );
}

export function deleteNeNasheBrandingEntry(db, id) {
  const existing = db.prepare('SELECT id FROM ne_nashe_branding_items WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Ne-nashe branding entry not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM ne_nashe_branding_items WHERE id = ?').run(id);
}
