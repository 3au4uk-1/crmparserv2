import { callTelegram } from '../api-client.js';

export async function sendBannerPodryadText({ token, chatId, threadId, text }) {
  const messageText = String(text ?? '');
  if (!messageText.trim()) return;

  const body = { chat_id: chatId, text: messageText };
  if (threadId != null) body.message_thread_id = threadId;

  try {
    return await callTelegram(token, 'sendMessage', body);
  } catch {
    return await callTelegram(token, 'sendMessage', body);
  }
}
