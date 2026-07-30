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
 * @param {{ invoke: (request: unknown) => Promise<unknown> }} client
 * @param {string | number | bigint} chatId
 * @param {string | number | bigint} userId
 */
export async function inviteUserToChat(client, chatId, userId) {
  await client.invoke(
    new Api.channels.InviteToChannel({
      channel: chatId,
      users: [userId],
    }),
  );
}

/** @param {{ getMe: () => Promise<{ id: bigint | number }> }} client */
export async function getSelfUserId(client) {
  const me = await client.getMe();
  return String(me.id);
}
