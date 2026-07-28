import { normalizePattern } from './blacklist.js';

const VALID_MATCH_TYPES = new Set(['exact', 'substring']);

export function matchesDecorBlacklistEntry(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findDecorBlacklistMatch(itemName, entries = []) {
  for (const entry of entries) {
    if (matchesDecorBlacklistEntry(itemName, entry)) return entry;
  }
  return null;
}

export function isDecorBlacklisted(itemName, entries = []) {
  return findDecorBlacklistMatch(itemName, entries) !== null;
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

export function loadDecorBlacklist(db) {
  return db
    .prepare('SELECT * FROM decor_blacklist_items ORDER BY created_at ASC')
    .all()
    .map(mapRow);
}

export function findDecorBlacklistByPattern(db, pattern, matchType) {
  const normalized = normalizePattern(pattern);
  return db
    .prepare('SELECT * FROM decor_blacklist_items WHERE pattern = ? AND match_type = ?')
    .get(normalized, matchType);
}

export function createDecorBlacklistEntry(db, { pattern, matchType, sourceName = null }) {
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
  if (findDecorBlacklistByPattern(db, normalized, matchType)) {
    const err = new Error('Decor blacklist entry already exists');
    err.status = 409;
    throw err;
  }

  const result = db
    .prepare(
      'INSERT INTO decor_blacklist_items (pattern, match_type, source_name) VALUES (?, ?, ?)'
    )
    .run(normalized, matchType, sourceName);

  return mapRow(
    db.prepare('SELECT * FROM decor_blacklist_items WHERE id = ?').get(result.lastInsertRowid)
  );
}

export function deleteDecorBlacklistEntry(db, id) {
  const existing = db.prepare('SELECT id FROM decor_blacklist_items WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Decor blacklist entry not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM decor_blacklist_items WHERE id = ?').run(id);
}
