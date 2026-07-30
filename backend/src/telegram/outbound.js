const CAPTION_MAX = 1024;

export function splitCaption(text) {
  const value = text ?? '';
  if (value.length <= CAPTION_MAX) {
    return { caption: value || null, separateMessage: null };
  }
  return { caption: null, separateMessage: value };
}

async function callTelegram(token, method, fetchImpl, init) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const resp = await fetchImpl(url, init);
  const data = typeof resp.json === 'function' ? await resp.json() : resp;
  if (!data.ok) {
    const err = new Error(data.description || 'Telegram API error');
    err.status = 502;
    throw err;
  }
  return data;
}

function appendThreadId(payload, threadId) {
  if (Number.isInteger(threadId) && threadId > 0) {
    payload.message_thread_id = threadId;
  }
  return payload;
}

async function sendTextMessage(token, chatId, text, fetchImpl, threadId) {
  const body = appendThreadId({ chat_id: chatId, text }, threadId);
  const data = await callTelegram(token, 'sendMessage', fetchImpl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.result.message_id;
}

async function sendPhotoAlbum(token, chatId, buffers, caption, fetchImpl, threadId) {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (Number.isInteger(threadId) && threadId > 0) {
    form.append('message_thread_id', String(threadId));
  }
  const media = buffers.map((_, index) => ({
    type: 'photo',
    media: `attach://file${index}`,
    ...(index === 0 && caption ? { caption } : {}),
  }));
  form.append('media', JSON.stringify(media));
  for (let index = 0; index < buffers.length; index += 1) {
    form.append(`file${index}`, new Blob([buffers[index]]), `photo${index}.jpg`);
  }
  const data = await callTelegram(token, 'sendMediaGroup', fetchImpl, {
    method: 'POST',
    body: form,
  });
  return data.result.map((message) => message.message_id);
}

async function downloadFile(url, fetchImpl) {
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export async function sendOkleykaToTelegram({
  token,
  chatId,
  threadId,
  text,
  fileUrls = [],
  fetchImpl = globalThis.fetch,
}) {
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

  const messageIds = [];

  if (buffers.length === 0) {
    const messageText = text ?? '';
    if (messageText.trim()) {
      messageIds.push(await sendTextMessage(token, chatId, messageText, fetchImpl, threadId));
    }
  } else {
    if (separateMessage) {
      messageIds.push(await sendTextMessage(token, chatId, separateMessage, fetchImpl, threadId));
    }
    const albumIds = await sendPhotoAlbum(
      token,
      chatId,
      buffers,
      caption,
      fetchImpl,
      threadId,
    );
    messageIds.push(...albumIds);
  }

  return {
    messageIds,
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  };
}
