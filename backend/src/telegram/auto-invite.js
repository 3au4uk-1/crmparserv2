import { getTelegramBotToken } from './settings.js';
import { createChatInviteLink, promoteChatMemberForInvite } from './bot-admin.js';
import { getUserbotClient, isUserbotConfigured } from './userbot/client.js';
import {
  joinChatByInviteLink,
  resolveUser,
  inviteUserToChat,
  getSelfUserId,
} from './userbot/actions.js';
import {
  tryBeginAutoInviteRun,
  finishAutoInviteRun,
  resetAutoInviteRun,
  listAutoInviteMembers,
  updateAutoInviteMember,
} from './auto-invite-store.js';

function defaultDeps(db) {
  return {
    getToken: (database) => getTelegramBotToken(database),
    createInviteLink: createChatInviteLink,
    promote: promoteChatMemberForInvite,
    getClient: getUserbotClient,
    joinInvite: joinChatByInviteLink,
    resolveUser,
    inviteUser: inviteUserToChat,
    getSelfUserId,
    listMembers: (database) => listAutoInviteMembers(database, { activeOnly: true }),
    isConfigured: isUserbotConfigured,
    updateMember: updateAutoInviteMember,
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

  const token = deps.getToken(db);
  if (!token) {
    return finishFailed({ error: 'bot token not configured' });
  }

  let client;
  try {
    const { inviteLink } = await deps.createInviteLink(token, chatId);
    client = await deps.getClient();
    await deps.joinInvite(client, inviteLink);
    const selfId = await deps.getSelfUserId(client);
    await deps.promote(token, chatId, selfId);
  } catch (err) {
    return finishFailed({ error: err?.message || String(err) });
  }

  const members = deps.listMembers(db);
  const memberResults = [];

  for (const member of members) {
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

  const detail = { members: memberResults };
  const status = memberResults.some((r) => r.status === 'failed') ? 'partial' : 'success';
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
