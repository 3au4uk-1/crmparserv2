import { getUserbotClient, isUserbotConfigured } from './userbot/client.js';
import {
  resolveUser,
  inviteUserToChat,
  canInviteToChat,
} from './userbot/actions.js';
import {
  tryBeginAutoInviteRun,
  finishAutoInviteRun,
  resetAutoInviteRun,
  listAutoInviteMembers,
  updateAutoInviteMember,
} from './auto-invite-store.js';

/** Max people invited per chat from the active list. */
export const AUTO_INVITE_MEMBER_CAP = 5;
/** Random delay between invites (ms). */
export const AUTO_INVITE_DELAY_MIN_MS = 5000;
export const AUTO_INVITE_DELAY_MAX_MS = 15000;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRandomDelayMs() {
  const span = AUTO_INVITE_DELAY_MAX_MS - AUTO_INVITE_DELAY_MIN_MS;
  return AUTO_INVITE_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
}

function defaultDeps(db) {
  return {
    getClient: () => getUserbotClient(db),
    canInvite: canInviteToChat,
    resolveUser,
    inviteUser: inviteUserToChat,
    listMembers: (database) => listAutoInviteMembers(database, { activeOnly: true }),
    isConfigured: () => isUserbotConfigured(db),
    updateMember: updateAutoInviteMember,
    sleep: defaultSleep,
    randomDelayMs: defaultRandomDelayMs,
  };
}

function mergeDeps(db, overrides = {}) {
  return { ...defaultDeps(db), ...overrides };
}

function parseExistingDetail(existing) {
  if (!existing?.detailJson) return null;
  try {
    return JSON.parse(existing.detailJson);
  } catch {
    return null;
  }
}

const ALREADY_PARTICIPANT_PATTERNS = [
  'USER_ALREADY_PARTICIPANT',
  'USER_ALREADY_INVITED',
  'ALREADY_PARTICIPANT',
  'ALREADY_IN_CHAT',
];

function isAlreadyParticipantError(err) {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  return ALREADY_PARTICIPANT_PATTERNS.some((pattern) => message.includes(pattern.toLowerCase()));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string | number} chatId
 * @param {{ force?: boolean, deps?: Record<string, unknown> }} [options]
 */
export async function runAutoInviteForChat(db, chatId, { force = false, deps: depOverrides } = {}) {
  const deps = mergeDeps(db, depOverrides);

  if (force) {
    resetAutoInviteRun(db, chatId);
  }

  const begin = tryBeginAutoInviteRun(db, chatId);
  if (!begin.started) {
    const existing = begin.existing;
    return {
      status: existing?.status ?? begin.reason,
      detail: parseExistingDetail(existing),
      skipped: true,
    };
  }

  const finishFailed = (detail) => {
    finishAutoInviteRun(db, chatId, { status: 'failed', detail });
    return { status: 'failed', detail };
  };

  if (!deps.isConfigured()) {
    return finishFailed({ error: 'userbot not configured' });
  }

  let client;
  try {
    client = await deps.getClient();
    const capability = await deps.canInvite(client, chatId);
    if (!capability?.ok) {
      return finishFailed({
        error: capability?.reason || 'User-bot cannot invite members to this chat',
      });
    }
  } catch (err) {
    return finishFailed({ error: err?.message || String(err) });
  }

  const members = deps.listMembers(db).slice(0, AUTO_INVITE_MEMBER_CAP);
  const memberResults = [];

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (index > 0) {
      await deps.sleep(deps.randomDelayMs());
    }
    try {
      const resolved = await deps.resolveUser(client, {
        userId: member.userId,
        username: member.username,
      });

      if (resolved.userId && member.id) {
        const patch = { userId: resolved.userId };
        if (resolved.username) patch.username = resolved.username;
        deps.updateMember(db, member.id, patch);
      }

      const targetUserId = resolved.userId ?? member.userId;
      await deps.inviteUser(client, chatId, targetUserId);
      memberResults.push({
        memberId: member.id,
        username: member.username,
        userId: targetUserId,
        status: 'invited',
      });
    } catch (err) {
      if (isAlreadyParticipantError(err)) {
        memberResults.push({
          memberId: member.id,
          username: member.username,
          userId: member.userId,
          status: 'skipped',
          reason: 'already_participant',
        });
      } else {
        memberResults.push({
          memberId: member.id,
          username: member.username,
          userId: member.userId,
          status: 'failed',
          error: err?.message || String(err),
        });
      }
    }
  }

  const detail = { members: memberResults, cappedAt: AUTO_INVITE_MEMBER_CAP };
  const hasMemberFailures = memberResults.some((r) => r.status === 'failed');
  const status = hasMemberFailures ? 'partial' : 'success';
  finishAutoInviteRun(db, chatId, { status, detail });
  return { status, detail };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string | number} chatId
 * @param {{ force?: boolean, deps?: Record<string, unknown> }} [options]
 */
export function scheduleAutoInvite(db, chatId, options = {}) {
  const immediate = setImmediate(() => {
    runAutoInviteForChat(db, chatId, options).catch((err) => {
      console.error('[auto-invite] scheduled run failed:', err);
    });
  });
  immediate.unref?.();
}
