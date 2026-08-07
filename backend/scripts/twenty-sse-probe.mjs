// backend/scripts/twenty-sse-probe.mjs
// Usage (from backend/): node scripts/twenty-sse-probe.mjs
// Answers one question: does the crmparser API key receive record events over SSE?
import crypto from 'node:crypto';

import { config } from '../src/config.js';

const metadataUrl = config.twentyApiUrl
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/(graphql|rest|metadata)$/, '') + '/metadata';
const token = config.twentyApiToken;

const SUBSCRIPTION = `
  subscription OnEventSubscription($eventStreamId: String!) {
    onEventSubscription(eventStreamId: $eventStreamId) {
      eventStreamId
      objectRecordEventsWithQueryIds {
        queryIds
        objectRecordEvent { action objectNameSingular recordId }
      }
    }
  }
`;

const log = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args);

const post = (body, extraHeaders = {}) =>
  fetch(metadataUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

const main = async () => {
  log('metadataUrl', metadataUrl, 'token?', Boolean(token));
  const eventStreamId = crypto.randomUUID();

  const stream = await post(
    { query: SUBSCRIPTION, variables: { eventStreamId } },
    { Accept: 'text/event-stream' },
  );
  log('SSE status', stream.status, stream.headers.get('content-type'));
  if (!stream.ok || !stream.body) {
    log('FAILED: stream did not open', await stream.text());
    process.exit(1);
  }

  void (async () => {
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return log('SSE closed');
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.trim() === ':') continue;
      log('SSE', chunk.replace(/\s+/g, ' ').slice(0, 500));
    }
  })();

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const add = await post({
    query:
      'mutation A($input: AddQuerySubscriptionInput!) { addQueryToEventStream(input: $input) }',
    variables: {
      input: {
        eventStreamId,
        queryId: 'probe-opportunity',
        operationSignature: { objectNameSingular: 'opportunity', variables: {} },
      },
    },
  });
  log('addQuery', add.status, await add.text());

  log('Now change any opportunity in the CRM UI. Waiting 60s for an event...');
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  process.exit(0);
};

main().catch((error) => {
  log('FATAL', error);
  process.exit(1);
});
