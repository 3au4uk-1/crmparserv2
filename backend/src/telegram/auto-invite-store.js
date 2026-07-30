const PENDING_STALE_MINUTES = 15;

export function normalizeUsername(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/^@+/, '').trim();
  return s || null;
}

function rowToMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    userId: row.user_id,
    displayName: row.display_name,
    active: row.active === 1,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row) {
  if (!row) return null;
  return {
    chatId: row.chat_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    detailJson: row.detail_json,
  };
}

export function upsertAutoInviteMember(db, { username, userId, displayName, active = true }) {
  const normalizedUsername = username != null ? normalizeUsername(username) : null;
  const normalizedUserId = userId != null ? String(userId).trim() || null : null;
  if (!normalizedUsername && !normalizedUserId) {
    throw new Error('username or userId is required');
  }

  let existing = null;
  if (normalizedUsername) {
    existing = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE username = ?`).get(normalizedUsername);
  }
  if (!existing && normalizedUserId) {
    existing = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE user_id = ?`).get(normalizedUserId);
  }

  if (existing) {
    const nextUsername = normalizedUsername ?? existing.username;
    const nextUserId = normalizedUserId ?? existing.user_id;
    db.prepare(`
      UPDATE telegram_auto_invite_members
      SET username = ?, user_id = ?, display_name = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      nextUsername,
      nextUserId,
      displayName ?? null,
      active ? 1 : 0,
      existing.id,
    );
    const row = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE id = ?`).get(existing.id);
    return rowToMember(row);
  }

  const result = db.prepare(`
    INSERT INTO telegram_auto_invite_members
      (username, user_id, display_name, active, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(
    normalizedUsername,
    normalizedUserId,
    displayName ?? null,
    active ? 1 : 0,
  );

  const row = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE id = ?`).get(result.lastInsertRowid);
  return rowToMember(row);
}

export function listAutoInviteMembers(db, { activeOnly = true } = {}) {
  const rows = activeOnly
    ? db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE active = 1 ORDER BY id`).all()
    : db.prepare(`SELECT * FROM telegram_auto_invite_members ORDER BY id`).all();
  return rows.map(rowToMember);
}

export function updateAutoInviteMember(db, id, patch) {
  const existing = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE id = ?`).get(id);
  if (!existing) return null;

  const username = patch.username !== undefined
    ? (patch.username != null ? normalizeUsername(patch.username) : null)
    : existing.username;
  const userId = patch.userId !== undefined
    ? (patch.userId != null ? String(patch.userId).trim() || null : null)
    : existing.user_id;
  if (!username && !userId) {
    throw new Error('username or userId is required');
  }

  const displayName = patch.displayName !== undefined ? patch.displayName : existing.display_name;
  const active = patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active;

  db.prepare(`
    UPDATE telegram_auto_invite_members
    SET username = ?, user_id = ?, display_name = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(username, userId, displayName, active, id);

  const row = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE id = ?`).get(id);
  return rowToMember(row);
}

export function deleteAutoInviteMember(db, id) {
  const result = db.prepare(`DELETE FROM telegram_auto_invite_members WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getAutoInviteRun(db, chatId) {
  const row = db.prepare(`SELECT * FROM telegram_auto_invite_runs WHERE chat_id = ?`).get(String(chatId));
  return rowToRun(row);
}

function isPendingStale(startedAt) {
  if (!startedAt) return false;
  const startedMs = Date.parse(startedAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(startedMs)) return false;
  return Date.now() - startedMs > PENDING_STALE_MINUTES * 60 * 1000;
}

export function tryBeginAutoInviteRun(db, chatId) {
  const key = String(chatId);
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const existing = db.prepare(`SELECT * FROM telegram_auto_invite_runs WHERE chat_id = ?`).get(key);

    if (!existing) {
      db.prepare(`
        INSERT INTO telegram_auto_invite_runs (chat_id, status, started_at, finished_at, detail_json)
        VALUES (?, 'pending', datetime('now'), NULL, NULL)
      `).run(key);
      db.prepare('COMMIT').run();
      return { started: true };
    }

    if (existing.status === 'failed') {
      db.prepare(`
        UPDATE telegram_auto_invite_runs
        SET status = 'pending', started_at = datetime('now'), finished_at = NULL, detail_json = NULL
        WHERE chat_id = ?
      `).run(key);
      db.prepare('COMMIT').run();
      return { started: true };
    }

    if (existing.status === 'pending' && isPendingStale(existing.started_at)) {
      db.prepare(`
        UPDATE telegram_auto_invite_runs
        SET status = 'pending', started_at = datetime('now'), finished_at = NULL, detail_json = NULL
        WHERE chat_id = ?
      `).run(key);
      db.prepare('COMMIT').run();
      return { started: true };
    }

    db.prepare('COMMIT').run();
    if (existing.status === 'success' || existing.status === 'partial' || existing.status === 'pending') {
      return {
        started: false,
        reason: existing.status,
        existing: rowToRun(existing),
      };
    }

    return {
      started: false,
      reason: existing.status,
      existing: rowToRun(existing),
    };
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
}

export function finishAutoInviteRun(db, chatId, { status, detail }) {
  const detailJson = detail != null ? JSON.stringify(detail) : null;
  db.prepare(`
    UPDATE telegram_auto_invite_runs
    SET status = ?, finished_at = datetime('now'), detail_json = ?
    WHERE chat_id = ?
  `).run(status, detailJson, String(chatId));
}

export function resetAutoInviteRun(db, chatId) {
  db.prepare(`DELETE FROM telegram_auto_invite_runs WHERE chat_id = ?`).run(String(chatId));
}
