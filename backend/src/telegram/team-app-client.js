function teamAppBase(config) {
  return String(config?.teamAppBaseUrl || '').replace(/\/+$/, '');
}

async function teamAppPost(config, path, body, fetchImpl = globalThis.fetch) {
  const url = `${teamAppBase(config)}${path}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Chat-Secret': config?.teamAppChatSecret || '',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${path.slice(1)} ${response.status} ${text}`.trim());
  }
  return response.json();
}

export async function teamAppIngest(config, body, fetchImpl) {
  return teamAppPost(config, '/internal/chat/telegram-inbound', body, fetchImpl);
}

export async function teamAppConsumeLink(config, { code, telegramUserId }, fetchImpl) {
  return teamAppPost(config, '/internal/chat/link-consume', { code, telegramUserId }, fetchImpl);
}
