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
  await callTelegram(token, 'editMessageText', {
    chat_id: link.chatId,
    message_id: link.botMessageId,
    text,
    parse_mode: 'HTML',
  });
  updateWorkRequestLink(db, link.id, { lastPublishedText: replyText });
  return { ok: true };
}
