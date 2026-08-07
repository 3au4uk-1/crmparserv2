export function messageMatchesDigestDest({ sourceChatId, messageThreadId, dest } = {}) {
  if (!dest?.chatId || !sourceChatId) return false;
  if (String(sourceChatId) !== String(dest.chatId)) return false;
  if (dest.threadId != null) {
    return Number(messageThreadId) === Number(dest.threadId);
  }
  return true;
}
