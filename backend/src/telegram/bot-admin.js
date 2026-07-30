import { callTelegram } from './api-client.js';

export async function createChatInviteLink(token, chatId, { fetchImpl } = {}) {
  const result = await callTelegram(
    token,
    'createChatInviteLink',
    {
      chat_id: chatId,
      name: 'auto-invite',
      member_limit: 10,
    },
    fetchImpl,
  );
  return { inviteLink: result.invite_link };
}

export async function promoteChatMemberForInvite(token, chatId, userId, { fetchImpl } = {}) {
  await callTelegram(
    token,
    'promoteChatMember',
    {
      chat_id: chatId,
      user_id: Number(userId),
      can_invite_users: true,
      can_manage_chat: false,
      can_delete_messages: false,
      can_restrict_members: false,
      can_promote_members: false,
      can_change_info: false,
      can_pin_messages: false,
      can_manage_video_chats: false,
    },
    fetchImpl,
  );
}
