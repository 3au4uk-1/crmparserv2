import { config } from '../../config.js';
import { createTwentyGqlClient } from '../../services/twenty-gql.js';
import { getTelegramBotToken } from '../settings.js';
import { getWorkRequestLinkByTwentyId } from './store.js';
import { publishWorkRequestReply as defaultPublish } from './publish.js';
import { updateTelegramRequest as defaultUpdate } from './twenty.js';

function makeUpdater(deps) {
  if (deps.updateTelegramRequest) return deps.updateTelegramRequest;
  const gql = deps.gql ?? (
    config.twentyApiUrl && config.twentyApiToken
      ? createTwentyGqlClient(config.twentyApiUrl, config.twentyApiToken)
      : null
  );
  return gql
    ? (id, input) => defaultUpdate(gql, id, input, config.twentyApiUrl)
    : null;
}

export async function handleTelegramRequestRecordEvent({ db, payload, deps = {} }) {
  const after = payload?.record || payload?.properties?.after;
  const before = payload?.properties?.before;
  if (!after?.id || after.stage !== 'DONE') return { action: 'ignore' };

  const updateTelegramRequest = makeUpdater(deps);
  const link = getWorkRequestLinkByTwentyId(db, after.id);
  if (!link) {
    if (updateTelegramRequest) {
      await updateTelegramRequest(after.id, { publishError: 'нет связки с чатом' });
    }
    return { action: 'no_link' };
  }

  const replyText = String(after.replyText ?? '');
  if (!replyText.trim()) {
    if (updateTelegramRequest) {
      await updateTelegramRequest(after.id, {
        stage: before?.stage || 'IN_PROGRESS',
        publishError: 'Сначала заполни «Ответ в чат»',
      });
    }
    return { action: 'reverted' };
  }

  const firstDoneTransition = before?.stage !== 'DONE';
  if (
    !firstDoneTransition
    && replyText === link.lastPublishedText
    && !after.republishRequested
  ) {
    return { action: 'noop' };
  }

  const mention = firstDoneTransition
    ? true
    : Boolean(after.republishRequested && after.notifyOnRepublish);
  const publish = deps.publishWorkRequestReply ?? defaultPublish;

  try {
    await publish({
      db,
      token: deps.token || getTelegramBotToken(db),
      link,
      replyText,
      mention,
      callTelegram: deps.callTelegram,
    });
  } catch (error) {
    if (updateTelegramRequest) {
      await updateTelegramRequest(after.id, {
        publishError: error?.message || 'Не удалось опубликовать ответ',
      });
    }
    return { action: 'publish_error', error };
  }

  if (after.republishRequested && updateTelegramRequest) {
    await updateTelegramRequest(after.id, {
      republishRequested: false,
      publishError: '',
    });
  }
  return { action: 'published' };
}
