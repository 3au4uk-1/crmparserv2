import { ALLOWED_TIPS, isTipDetailValidForTip } from './tip-taxonomy.js';

function normalizePattern(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е').trim();
}

export function matchesTipRule(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findTipRuleMatch(itemName, rules = []) {
  const sorted = [...rules].sort((a, b) => {
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
  for (const entry of sorted) {
    if (matchesTipRule(itemName, entry)) return entry;
  }
  return null;
}

function mapRow(row) {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.match_type,
    tip: row.tip,
    tipDetail: row.tip_detail,
    priority: row.priority,
    sourceName: row.source_name,
    createdAt: row.created_at,
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function loadTipRules(db, tip) {
  const rows = tip
    ? db
        .prepare('SELECT * FROM tip_rules WHERE tip = ? ORDER BY priority ASC, created_at ASC')
        .all(tip)
    : db.prepare('SELECT * FROM tip_rules ORDER BY priority ASC, created_at ASC').all();
  return rows.map(mapRow);
}

export function createTipRule(
  db,
  { pattern, matchType, tip, tipDetail = null, priority = 100, sourceName = null }
) {
  const normalized = normalizePattern(pattern);
  if (!normalized) throw badRequest('pattern is required');
  if (!['exact', 'substring'].includes(matchType)) {
    throw badRequest('matchType must be exact or substring');
  }
  if (!ALLOWED_TIPS.includes(tip)) throw badRequest('invalid tip');
  if (tipDetail && !isTipDetailValidForTip(tip, tipDetail)) {
    throw badRequest('tipDetail is not valid for tip');
  }

  const existing = db
    .prepare(
      `SELECT id FROM tip_rules
       WHERE pattern = ? AND match_type = ? AND tip = ?
         AND IFNULL(tip_detail, '') = IFNULL(?, '')`
    )
    .get(normalized, matchType, tip, tipDetail);
  if (existing) {
    const error = new Error('Tip rule already exists');
    error.status = 409;
    throw error;
  }

  const result = db
    .prepare(
      `INSERT INTO tip_rules (pattern, match_type, tip, tip_detail, priority, source_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(normalized, matchType, tip, tipDetail, priority, sourceName);
  return mapRow(db.prepare('SELECT * FROM tip_rules WHERE id = ?').get(result.lastInsertRowid));
}

export function deleteTipRule(db, id) {
  const result = db.prepare('DELETE FROM tip_rules WHERE id = ?').run(id);
  if (result.changes === 0) {
    const error = new Error('Tip rule not found');
    error.status = 404;
    throw error;
  }
}

const SEED_RULES = [
  {
    pattern: 'клише',
    matchType: 'substring',
    tip: 'PODRYAD',
    tipDetail: 'KUVALDIN_KLISHE',
    priority: 50,
  },
  {
    pattern: 'монета',
    matchType: 'substring',
    tip: 'PODRYAD',
    tipDetail: 'KUVALDIN_KLISHE',
    priority: 50,
  },
  {
    pattern: 'сукно',
    matchType: 'substring',
    tip: 'PODRYAD',
    tipDetail: 'LIZA_SUKNO',
    priority: 50,
  },
  {
    pattern: 'ролл-ап',
    matchType: 'substring',
    tip: 'PROIZVODSTVO',
    tipDetail: 'ROLL_UP',
    priority: 50,
  },
  {
    pattern: 'роллап',
    matchType: 'substring',
    tip: 'PROIZVODSTVO',
    tipDetail: 'ROLL_UP',
    priority: 50,
  },
  {
    pattern: 'поп-ап',
    matchType: 'substring',
    tip: 'PROIZVODSTVO',
    tipDetail: 'POP_UP',
    priority: 50,
  },
  {
    pattern: 'попап',
    matchType: 'substring',
    tip: 'PROIZVODSTVO',
    tipDetail: 'POP_UP',
    priority: 50,
  },
  {
    pattern: 'промо-стойк',
    matchType: 'substring',
    tip: 'PROIZVODSTVO',
    tipDetail: 'PROMO_STOYKA',
    priority: 50,
  },
  {
    pattern: 'оклейк',
    matchType: 'substring',
    tip: 'PLENKA',
    tipDetail: 'NASHI',
    priority: 50,
  },
];

export function seedDefaultTipRules(db) {
  for (const seed of SEED_RULES) {
    const pattern = normalizePattern(seed.pattern);
    const exists = db
      .prepare(
        `SELECT id FROM tip_rules
         WHERE pattern = ? AND match_type = ? AND tip = ?
           AND IFNULL(tip_detail, '') = IFNULL(?, '')`
      )
      .get(pattern, seed.matchType, seed.tip, seed.tipDetail);
    if (!exists) createTipRule(db, seed);
  }
}

export function migratePodryadBannerToTipRules(db) {
  const insertLegacyRows = (table, tip) => {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO tip_rules
       (pattern, match_type, tip, tip_detail, priority, source_name, created_at)
       VALUES (?, ?, ?, NULL, 100, ?, ?)`
    );
    for (const row of rows) {
      insert.run(row.pattern, row.match_type, tip, row.source_name, row.created_at);
    }
  };

  const migrateLegacyRows = db.transaction(() => {
    insertLegacyRows('podryad_items', 'PODRYAD');
    insertLegacyRows('banner_items', 'BANNERA');
  });
  migrateLegacyRows();
}
