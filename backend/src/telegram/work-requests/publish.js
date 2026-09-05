import { callTelegram as defaultCallTelegram } from '../api-client.js';
import { updateWorkRequestLink } from './store.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildDoneMessageHtml({
  replyText,
  requesterUserId,
  requesterUsername,
  requesterName,
  mention,
}) {
  const escapedReply = escapeHtml(replyText);
  if (!mention) return escapedReply;

  let managerMention;
  if (requesterUserId) {
    const label = requesterName || requesterUsername || 'менеджер';
    managerMention =
      `<a href="tg://user?id=${escapeHtml(requesterUserId)}">${escapeHtml(label)}</a>`;
  } else if (requesterUsername) {
    managerMention = `@${escapeHtml(requesterUsername)}`;
  } else {
    managerMention = 'менеджер';
  }
  return `${managerMention}\n\n${escapedReply}`;
}

export async function publishWorkRequestReply({
  db,
  token,
  link,
  replyText,
  mention,
  callTelegram = defaultCallTelegram,
}) {
  const text = buildDoneMessageHtml({
    replyText,
    requesterUserId: link.requesterUserId,
    requesterUsername: link.requesterUsername,
    requesterName: link.requesterName,
    mention,
  });
  let botMessageId = link.botMessageId;
  if (botMessageId) {
    await callTelegram(token, 'editMessageText', {
      chat_id: link.chatId,
      message_id: botMessageId,
      text,
      parse_mode: 'HTML',
    });
  } else {
    const sent = await callTelegram(token, 'sendMessage', {
      chat_id: link.chatId,
      message_thread_id: link.threadId,
      reply_to_message_id: link.sourceMessageId,
      text,
      parse_mode: 'HTML',
    });
    botMessageId = sent?.message_id ?? null;
  }
  updateWorkRequestLink(db, link.id, {
    botMessageId,
    lastPublishedText: replyText,
  });
  return { ok: true };
}
