import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getTeamAppMirrorSettings } from '../telegram/team-app-mirror-settings.js';
import { getUserbotClient } from '../telegram/userbot/client.js';
import {
  rememberOutboxTelegramId,
  sendTopicMessage,
} from '../telegram/userbot/team-app-mirror.js';

const router = Router();
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function decodeMirrorAttachment(attachment) {
  if (!attachment?.bytesBase64) {
    return undefined;
  }
  const buffer = Buffer.from(attachment.bytesBase64, 'base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new Error('File too large (max. 20 MB)'), { status: 413 });
  }
  return buffer;
}

router.post('/mirror-send', async (req, res, next) => {
  try {
    const secret = config.teamAppChatSecret;
    if (!secret || req.get('X-Chat-Secret') !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const settings = getTeamAppMirrorSettings(getDb());
    if (!settings.chatId || settings.topicId == null) {
      return res.status(503).json({ error: 'mirror not configured' });
    }

    const payload = req.body ?? {};
    const attachment = payload.attachment;
    const fileBuffer = decodeMirrorAttachment(attachment);

    const client = await getUserbotClient(getDb());
    const telegramMessageId = await sendTopicMessage({
      client,
      chatId: settings.chatId,
      threadId: settings.topicId,
      authorLabel: payload.authorLabel,
      kind: payload.kind,
      body: payload.body,
      fileBuffer,
      filename: attachment?.filename,
      mime: attachment?.mime,
    });
    rememberOutboxTelegramId(telegramMessageId);
    res.json({ telegramMessageId });
  } catch (err) {
    next(err);
  }
});

export default router;
