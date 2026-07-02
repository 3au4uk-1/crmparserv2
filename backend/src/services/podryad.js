import { normalizePattern } from './blacklist.js';

export const PODRYAD_TIP = 'PODRYAD';

const VALID_MATCH_TYPES = new Set(['exact', 'substring']);

export function matchesPodryadEntry(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findPodryadMatch(itemName, entries = []) {
  for (const entry of entries) {
    if (matchesPodryadEntry(itemName, entry)) return entry;
  }
  return null;
}

export function isPodryadItem(itemName, entries = []) {
  return findPodryadMatch(itemName, entries) !== null;
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

export function loadPodryadList(db) {
  return db
    .prepare('SELECT * FROM podryad_items ORDER BY created_at ASC')
    .all()
    .map(mapRow);
}

export function findPodryadByPattern(db, pattern, matchType) {
  const normalized = normalizePattern(pattern);
  return db
    .prepare('SELECT * FROM podryad_items WHERE pattern = ? AND match_type = ?')
    .get(normalized, matchType);
}

export function createPodryadEntry(db, { pattern, matchType, sourceName = null }) {
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
  if (findPodryadByPattern(db, normalized, matchType)) {
    const err = new Error('Podryad entry already exists');
    err.status = 409;
    throw err;
  }

  const result = db
    .prepare(
      'INSERT INTO podryad_items (pattern, match_type, source_name) VALUES (?, ?, ?)'
    )
    .run(normalized, matchType, sourceName);

  return mapRow(
    db.prepare('SELECT * FROM podryad_items WHERE id = ?').get(result.lastInsertRowid)
  );
}

export function deletePodryadEntry(db, id) {
  const existing = db.prepare('SELECT id FROM podryad_items WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Podryad entry not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM podryad_items WHERE id = ?').run(id);
}
