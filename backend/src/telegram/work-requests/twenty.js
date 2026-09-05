import { assertGqlSuccess, assertHttpSuccess } from '../../services/twenty-gql.js';

const DEFAULT_API_URL = 'Twenty GraphQL';

const CREATE_TELEGRAM_REQUEST = `
  mutation CreateTelegramRequest($data: TelegramRequestCreateInput!) {
    createTelegramRequest(data: $data) { id }
  }
`;

const UPDATE_TELEGRAM_REQUEST = `
  mutation UpdateTelegramRequest($id: ID!, $data: TelegramRequestUpdateInput!) {
    updateTelegramRequest(id: $id, data: $data) { id }
  }
`;

export function telegramMessageUrl(chatId, messageId) {
  const chat = String(chatId);
  const internalId = chat.startsWith('-100') ? chat.slice(4) : chat.replace(/^-/, '');
  return `https://t.me/c/${internalId}/${messageId}`;
}

export async function createTelegramRequest(gql, input, apiUrl = DEFAULT_API_URL) {
  const resp = await gql(CREATE_TELEGRAM_REQUEST, { data: input });
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'createTelegramRequest');
  return resp.data?.data?.createTelegramRequest?.id;
}

export async function updateTelegramRequest(gql, id, input, apiUrl = DEFAULT_API_URL) {
  const resp = await gql(UPDATE_TELEGRAM_REQUEST, { id, data: input });
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'updateTelegramRequest');
  return resp.data?.data?.updateTelegramRequest;
}
