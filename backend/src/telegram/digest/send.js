export async function sendDigestText({ client, chatId, threadId, text }) {
  if (!client) throw new Error('userbot client required');
  const messageText = String(text ?? '');
  if (!messageText.trim()) return;
  const replyTo = Number.isInteger(threadId) && threadId > 0 ? threadId : undefined;
  await client.sendMessage(chatId, {
    message: messageText,
    ...(replyTo ? { replyTo } : {}),
  });
}
