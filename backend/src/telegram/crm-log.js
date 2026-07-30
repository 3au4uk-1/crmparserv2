import { gql } from '../services/twenty-gql.js';
import { requireTwentyConfig } from '../services/twenty-config.js';

const UPDATE_OKLEYKA_TELEGRAM = `
  mutation UpdateDealLineItemOkleykaTelegram($id: ID!, $input: DealLineItemUpdateInput!) {
    updateDealLineItem(id: $id, data: $input) { id }
  }
`;

export async function patchOkleykaTelegramFields({ lineItemId, sentAt, sentBy, chatId }) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  await gql(apiUrl, apiToken, UPDATE_OKLEYKA_TELEGRAM, {
    id: lineItemId,
    input: {
      okleykaTelegramSentAt: sentAt,
      okleykaTelegramSentBy: sentBy ?? null,
      okleykaTelegramChatId: chatId ?? null,
    },
  });
}
