const CAPTION_MAX = 1024;

export function splitCaption(text) {
  const value = text ?? '';
  if (value.length <= CAPTION_MAX) {
    return { caption: value || null, separateMessage: null };
  }
  return { caption: null, separateMessage: value };
}

async function downloadFile(url, fetchImpl) {
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

function extractMessageIds(result) {
  if (!result) return [];
  if (Array.isArray(result)) {
    return result.map((m) => Number(m.id ?? m.message_id)).filter((n) => Number.isFinite(n));
  }
  const id = Number(result.id ?? result.message_id);
  return Number.isFinite(id) ? [id] : [];
}

/**
 * Send okleyka payload via GramJS user-bot (MTProto).
 *
 * @param {{
 *   client: { sendMessage: Function, sendFile: Function },
 *   chatId: string | number,
 *   threadId?: number | null,
 *   text?: string,
 *   fileUrls?: string[],
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function sendOkleykaToTelegram({
  client,
  chatId,
  threadId,
  text,
  fileUrls = [],
  fetchImpl = globalThis.fetch,
}) {
  if (!client) {
    throw new Error('userbot client required');
  }

  const { caption, separateMessage } = splitCaption(text ?? '');
  const warnings = [];
  const buffers = [];

  for (const fileUrl of fileUrls) {
    try {
      buffers.push(await downloadFile(fileUrl, fetchImpl));
    } catch (err) {
      warnings.push(`Failed to download ${fileUrl}: ${err.message}`);
    }
  }

  const replyTo = Number.isInteger(threadId) && threadId > 0 ? threadId : undefined;
  const messageIds = [];

  if (buffers.length === 0) {
    const messageText = text ?? '';
    if (messageText.trim()) {
      const result = await client.sendMessage(chatId, {
        message: messageText,
        ...(replyTo ? { replyTo } : {}),
      });
      messageIds.push(...extractMessageIds(result));
    }
  } else {
    if (separateMessage) {
      const result = await client.sendMessage(chatId, {
        message: separateMessage,
        ...(replyTo ? { replyTo } : {}),
      });
      messageIds.push(...extractMessageIds(result));
    }
    const result = await client.sendFile(chatId, {
      file: buffers.length === 1 ? buffers[0] : buffers,
      caption: caption || undefined,
      ...(replyTo ? { replyTo } : {}),
    });
    messageIds.push(...extractMessageIds(result));
  }

  return {
    messageIds,
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  };
}
