import { Api } from 'telegram';

/** @param {string} inviteLink */
export function extractInviteHash(inviteLink) {
  const trimmed = String(inviteLink || '').trim();
  const plusMatch = trimmed.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i);
  if (plusMatch) return plusMatch[1];
  const joinchatMatch = trimmed.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
  if (joinchatMatch) return joinchatMatch[1];
  throw new Error(`Invalid invite link: ${inviteLink}`);
}

/**
 * @param {{ getEntity: (input: string | number | bigint) => Promise<{ id?: bigint | number, username?: string }> }} client
 * @param {{ userId?: string, username?: string }} target
 */
export async function resolveUser(client, { userId, username } = {}) {
  if (!userId && !username) {
    throw new Error('userId or username required');
  }
  const input = userId != null && userId !== '' ? userId : username;
  const entity = await client.getEntity(input);
  const resolvedId = entity?.id != null ? String(entity.id) : String(userId);
  const result = { userId: resolvedId };
  if (entity?.username) {
    result.username = entity.username;
  } else if (username) {
    result.username = String(username).replace(/^@/, '');
  }
  return result;
}

/**
 * @param {{ invoke: (request: unknown) => Promise<unknown> }} client
 * @param {string} inviteLink
 */
export async function joinChatByInviteLink(client, inviteLink) {
  const hash = extractInviteHash(inviteLink);
  await client.invoke(new Api.messages.ImportChatInvite({ hash }));
}

/**
 * Invites a user into a chat. Basic groups (InputPeerChat) require
 * messages.AddChatUser; supergroups/channels use channels.InviteToChannel.
 *
 * @param {{ invoke: (request: unknown) => Promise<unknown>, getInputEntity: (input: string | number | bigint) => Promise<object> }} client
 * @param {string | number | bigint} chatId
 * @param {string | number | bigint} userId
 */
export async function inviteUserToChat(client, chatId, userId) {
  const inputPeer = await client.getInputEntity(chatId);
  if (inputPeer?.className === 'InputPeerChat') {
    await client.invoke(
      new Api.messages.AddChatUser({
        chatId: inputPeer.chatId,
        userId,
        fwdLimit: 0,
      }),
    );
    return;
  }
  await client.invoke(
    new Api.channels.InviteToChannel({
      channel: inputPeer,
      users: [userId],
    }),
  );
}

/** @param {{ getMe: () => Promise<{ id: bigint | number }> }} client */
export async function getSelfUserId(client) {
  const me = await client.getMe();
  return String(me.id);
}

/**
 * Whether the user-bot can invite members into this chat.
 * True when self is admin with inviteUsers, or defaultBannedRights do not ban invites.
 *
 * @param {{ getEntity: (input: string | number | bigint) => Promise<object> }} client
 * @param {string | number | bigint} chatId
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function canInviteToChat(client, chatId) {
  const entity = await client.getEntity(chatId);
  const adminRights = entity?.adminRights ?? entity?.participant?.adminRights;
  if (adminRights?.inviteUsers === true) {
    return { ok: true };
  }
  const banned = entity?.defaultBannedRights;
  if (banned && banned.inviteUsers === true) {
    return {
      ok: false,
      reason: 'User-bot cannot invite: group forbids member invites and account is not an admin with inviteUsers',
    };
  }
  // No ban on invites (or missing rights object) → ordinary members may invite.
  if (adminRights && adminRights.inviteUsers === false) {
    return {
      ok: false,
      reason: 'User-bot is admin without inviteUsers right',
    };
  }
  return { ok: true };
}
