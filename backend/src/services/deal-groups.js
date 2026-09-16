function paymentAmount(member) {
  return Number(member?.payment_amount) || 0;
}

function amountRub(member) {
  return Number(member?.amountRub) || 0;
}

function firstBitrixId(member) {
  const ids = member?.bitrixIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return String(ids[0]);
}

/**
 * Pick canonical smeta: exactly one payment → that deal; none → max amountRub;
 * two+ payments → needsManual.
 */
export function pickCanonicalDeal(members) {
  const list = Array.isArray(members) ? members : [];
  const paid = list.filter((m) => paymentAmount(m) > 0);
  if (paid.length >= 2) return { needsManual: true };
  if (paid.length === 1) {
    return { dealId: paid[0].id, bitrixId: firstBitrixId(paid[0]) };
  }
  if (list.length === 0) return { needsManual: true };

  let best = list[0];
  for (const m of list.slice(1)) {
    if (amountRub(m) > amountRub(best)) best = m;
    else if (amountRub(m) === amountRub(best) && m.id < best.id) best = m;
  }
  return { dealId: best.id, bitrixId: firstBitrixId(best) };
}

export function computeParentMoney(members, canonicalDealId) {
  const list = Array.isArray(members) ? members : [];
  const amount = list.reduce((sum, m) => sum + amountRub(m), 0);
  const canonical = list.find((m) => m.id === canonicalDealId) || null;
  return {
    amount,
    summaPostupleniy: paymentAmount(canonical),
    rashodItogo: Number(canonical?.rashodItogo) || 0,
  };
}

/** Deduplicate expense rows by bitrixId; sum amount keys once per Bitrix. */
export function planExpenseRollup(memberExpenses, canonicalDealId) {
  const seen = new Set();
  const amounts = {};
  for (const row of memberExpenses || []) {
    const bitrixId = row?.bitrixId != null ? String(row.bitrixId) : '';
    if (!bitrixId || seen.has(bitrixId)) continue;
    seen.add(bitrixId);
    const rowAmounts = row.amounts || {};
    for (const [key, value] of Object.entries(rowAmounts)) {
      amounts[key] = (amounts[key] || 0) + (Number(value) || 0);
    }
  }
  return { canonicalDealId, amounts };
}

function alreadyGroupedError(dealId) {
  const err = new Error(`Deal ${dealId} is already in a group`);
  err.code = 'ALREADY_GROUPED';
  err.dealId = dealId;
  err.status = 409;
  return err;
}

function resolveCanonicalBitrixId(db, canonicalDealId, preferredBitrixId) {
  if (preferredBitrixId != null && String(preferredBitrixId).trim() !== '') {
    const bitrixId = String(preferredBitrixId).trim();
    const row = db.prepare(
      `SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? AND bitrix_id = ?`,
    ).get(canonicalDealId, bitrixId);
    if (!row) {
      const err = new Error(
        `canonical_bitrix_id ${bitrixId} not on deal ${canonicalDealId}`,
      );
      err.code = 'INVALID_CANONICAL_BITRIX';
      err.status = 400;
      throw err;
    }
    return bitrixId;
  }

  const canonicalLink = db.prepare(
    `SELECT bitrix_id FROM deal_bitrix_links
     WHERE deal_id = ? AND is_canonical = 1
     ORDER BY id LIMIT 1`,
  ).get(canonicalDealId);
  if (canonicalLink) return canonicalLink.bitrix_id;

  const anyLink = db.prepare(
    `SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? ORDER BY id LIMIT 1`,
  ).get(canonicalDealId);
  if (!anyLink) {
    const err = new Error(`No Bitrix link on canonical deal ${canonicalDealId}`);
    err.code = 'MISSING_CANONICAL_BITRIX';
    err.status = 400;
    throw err;
  }
  return anyLink.bitrix_id;
}

function loadGroup(db, groupId) {
  return db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
}

/**
 * Persist a confirmed group. Rejects deals already in another group (409 ALREADY_GROUPED).
 * Does not delete smeta twenty_id / line items / Bitrix links.
 */
export function confirmDealGroup(db, opts = {}) {
  const dealIds = [...new Set((opts.dealIds || []).map(Number))];
  if (dealIds.length < 2) {
    const err = new Error('dealIds must include at least two deals');
    err.code = 'TOO_FEW_DEALS';
    err.status = 400;
    throw err;
  }

  for (const dealId of dealIds) {
    const existing = db.prepare(
      'SELECT group_id FROM deal_group_members WHERE deal_id = ?',
    ).get(dealId);
    if (existing) throw alreadyGroupedError(dealId);
  }

  const deals = dealIds.map((id) => {
    const row = db.prepare(
      `SELECT id, title, payment_amount, twenty_id FROM deals WHERE id = ?`,
    ).get(id);
    if (!row) {
      const err = new Error(`Deal ${id} not found`);
      err.code = 'DEAL_NOT_FOUND';
      err.status = 404;
      err.dealId = id;
      throw err;
    }
    const links = db.prepare(
      `SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? ORDER BY id`,
    ).all(id);
    return {
      id: row.id,
      title: row.title,
      payment_amount: row.payment_amount,
      twenty_id: row.twenty_id,
      amountRub: 0,
      bitrixIds: links.map((l) => l.bitrix_id),
    };
  });

  let canonicalDealId = opts.canonicalDealId != null ? Number(opts.canonicalDealId) : null;
  let canonicalBitrixId = opts.canonicalBitrixId != null
    ? String(opts.canonicalBitrixId)
    : null;
  const canonicalLocked = Boolean(opts.canonicalLocked);

  if (canonicalDealId == null) {
    const picked = pickCanonicalDeal(deals);
    if (picked.needsManual) {
      const err = new Error('canonical_required');
      err.code = 'CANONICAL_REQUIRED';
      err.status = 400;
      throw err;
    }
    canonicalDealId = picked.dealId;
    if (canonicalBitrixId == null) canonicalBitrixId = picked.bitrixId;
  }

  if (!dealIds.includes(canonicalDealId)) {
    const err = new Error('canonicalDealId must be a group member');
    err.code = 'INVALID_CANONICAL_DEAL';
    err.status = 400;
    throw err;
  }

  canonicalBitrixId = resolveCanonicalBitrixId(db, canonicalDealId, canonicalBitrixId);

  // nameLocked only when client sends nameLocked: true (explicit override), not merely when name is set.
  const nameProvided = opts.name != null && String(opts.name).trim() !== '';
  const lockedName = Boolean(opts.nameLocked);
  const canonicalDeal = deals.find((d) => d.id === canonicalDealId);
  const name = nameProvided
    ? String(opts.name).trim()
    : (canonicalDeal?.title || `Group ${canonicalDealId}`);

  const insertGroup = db.prepare(`
    INSERT INTO deal_groups (
      name, name_locked, canonical_deal_id, canonical_bitrix_id, canonical_locked
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(
    `INSERT INTO deal_group_members (group_id, deal_id) VALUES (?, ?)`,
  );

  const groupId = db.transaction(() => {
    const info = insertGroup.run(
      name,
      lockedName ? 1 : 0,
      canonicalDealId,
      canonicalBitrixId,
      canonicalLocked ? 1 : 0,
    );
    const id = Number(info.lastInsertRowid);
    for (const dealId of dealIds) insertMember.run(id, dealId);
    return id;
  })();

  return loadGroup(db, groupId);
}

export function dissolveDealGroup(db, groupId) {
  db.prepare('DELETE FROM deal_groups WHERE id = ?').run(groupId);
}

export function unlinkDealFromGroup(db, dealId) {
  const membership = db.prepare(
    'SELECT group_id FROM deal_group_members WHERE deal_id = ?',
  ).get(dealId);
  if (!membership) return { dissolved: false };

  const groupId = membership.group_id;
  return db.transaction(() => {
    db.prepare('DELETE FROM deal_group_members WHERE deal_id = ?').run(dealId);
    const remaining = db.prepare(
      'SELECT COUNT(*) AS n FROM deal_group_members WHERE group_id = ?',
    ).get(groupId).n;
    if (remaining === 0) {
      db.prepare('DELETE FROM deal_groups WHERE id = ?').run(groupId);
      return { dissolved: true };
    }
    return { dissolved: false };
  })();
}

/**
 * Auto-switch canonical to the sole paid member when unlocked.
 * Returns false when canonical_locked or two+ payments (or no switch needed).
 */
export function maybeAutoSwitchCanonical(db, groupId) {
  const group = loadGroup(db, groupId);
  if (!group) return false;
  if (group.canonical_locked) return false;

  const members = db.prepare(`
    SELECT d.id, d.payment_amount, d.title,
           (SELECT bitrix_id FROM deal_bitrix_links l
            WHERE l.deal_id = d.id
            ORDER BY l.is_canonical DESC, l.id
            LIMIT 1) AS bitrix_id
    FROM deal_group_members m
    JOIN deals d ON d.id = m.deal_id
    WHERE m.group_id = ?
  `).all(groupId);

  const paid = members.filter((m) => (Number(m.payment_amount) || 0) > 0);
  // Auto-switch only when a single payment appears on a non-canonical smeta.
  // Zero payments → no switch; two+ → needs manual (never auto).
  if (paid.length !== 1) return false;
  if (paid[0].id === group.canonical_deal_id) return false;

  const bitrixId = resolveCanonicalBitrixId(
    db,
    paid[0].id,
    paid[0].bitrix_id,
  );
  db.prepare(`
    UPDATE deal_groups
    SET canonical_deal_id = ?,
        canonical_bitrix_id = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(paid[0].id, bitrixId, groupId);
  return true;
}
