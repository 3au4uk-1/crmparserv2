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

function assertRecordId(record, context) {
  const id = record?.id;
  if (!id) {
    throw new Error(`${context}: Twenty response missing record id`);
  }
  return id;
}

export async function createTelegramRequest(gql, input, apiUrl = DEFAULT_API_URL) {
  const resp = await gql(CREATE_TELEGRAM_REQUEST, { data: input });
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'createTelegramRequest');
  return assertRecordId(resp.data?.data?.createTelegramRequest, 'createTelegramRequest');
}

export async function updateTelegramRequest(gql, id, input, apiUrl = DEFAULT_API_URL) {
  const resp = await gql(UPDATE_TELEGRAM_REQUEST, { id, data: input });
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'updateTelegramRequest');
  const record = resp.data?.data?.updateTelegramRequest;
  assertRecordId(record, 'updateTelegramRequest');
  return record;
}
