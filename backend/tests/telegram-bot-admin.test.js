import { describe, expect, it, vi } from 'vitest';
import { createChatInviteLink, promoteChatMemberForInvite } from '../src/telegram/bot-admin.js';

function telegramFetch(result) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result }),
  }));
}

describe('createChatInviteLink', () => {
  it('calls createChatInviteLink with expected body and returns inviteLink', async () => {
    const fetchImpl = telegramFetch({ invite_link: 'https://t.me/+x' });
    const result = await createChatInviteLink('bot-token', '-100123', { fetchImpl });

    expect(result).toEqual({ inviteLink: 'https://t.me/+x' });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://api.telegram.org/botbot-token/createChatInviteLink',
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      chat_id: '-100123',
      name: 'auto-invite',
      member_limit: 10,
    });
  });
});

describe('promoteChatMemberForInvite', () => {
  it('calls promoteChatMember with can_invite_users only', async () => {
    const fetchImpl = telegramFetch(true);
    await promoteChatMemberForInvite('bot-token', '-100123', '456789', { fetchImpl });

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://api.telegram.org/botbot-token/promoteChatMember',
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      chat_id: '-100123',
      user_id: 456789,
      can_invite_users: true,
      can_manage_chat: false,
      can_delete_messages: false,
      can_restrict_members: false,
      can_promote_members: false,
      can_change_info: false,
      can_pin_messages: false,
      can_manage_video_chats: false,
    });
  });
});
