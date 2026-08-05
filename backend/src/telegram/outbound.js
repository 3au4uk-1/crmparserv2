const CAPTION_MAX = 1024;

/** Mime → filename so GramJS `isImage()` / upload picks photo vs document. */
const MIME_TO_NAME = {
  'image/jpeg': 'photo.jpg',
  'image/jpg': 'photo.jpg',
  'image/png': 'photo.png',
  'image/webp': 'photo.webp',
  'image/gif': 'photo.gif',
};

export function splitCaption(text) {
  const value = text ?? '';
  if (value.length <= CAPTION_MAX) {
    return { caption: value || null, separateMessage: null };
  }
  return { caption: null, separateMessage: value };
}

/**
 * Pick a filename with extension so GramJS sends photos as photos, not "unnamed" docs.
 * @param {string} url
 * @param {string | null | undefined} contentType
 */
export function guessUploadFileName(url, contentType) {
  try {
    const pathname = new URL(url).pathname;
    const base = decodeURIComponent(pathname.split('/').pop() || '');
    if (/\.(jpe?g|png|gif|webp)$/i.test(base)) {
      return base;
    }
  } catch {
    // ignore invalid URL
  }
  const mime = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (MIME_TO_NAME[mime]) return MIME_TO_NAME[mime];
  // Default to jpeg so typical okleyka images still preview as photos.
  return 'photo.jpg';
}

/**
 * @returns {Promise<Buffer & { name: string }>}
 */
async function downloadFile(url, fetchImpl) {
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  const contentType =
    typeof resp.headers?.get === 'function' ? resp.headers.get('content-type') : null;
  const buffer = Buffer.from(await resp.arrayBuffer());
  buffer.name = guessUploadFileName(url, contentType);
  return buffer;
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
      forceDocument: false,
      ...(replyTo ? { replyTo } : {}),
    });
    messageIds.push(...extractMessageIds(result));
  }

  return {
    messageIds,
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  };
}
