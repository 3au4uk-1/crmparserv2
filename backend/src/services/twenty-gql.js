import axios from 'axios';
import { config } from '../config.js';
import {
  logTwenty,
  parseGqlOperation,
  summarizeGqlVariables,
} from './twenty-sync-log.js';
import {
  acquireTwentyRateLimitSlot,
  isTwentyRateLimitError,
  parseTwentyRateLimitWaitMs,
} from './twenty-rate-limit.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(err) {
  return err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
}

export async function gql(apiUrl, apiToken, query, variables = {}, attempt = 0) {
  const maxAttempts = 5;
  const timeoutMs = config.twentyApiTimeoutMs;
  const operation = parseGqlOperation(query);
  const startedAt = Date.now();

  logTwenty('info', 'gql request start', {
    operation,
    attempt: attempt + 1,
    maxAttempts,
    timeoutMs,
    apiUrl,
    variables: summarizeGqlVariables(variables),
  });

  try {
    await acquireTwentyRateLimitSlot();

    const resp = await axios.post(
      apiUrl,
      { query, variables },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
        validateStatus: () => true,
      }
    );

    const durationMs = Date.now() - startedAt;
    const gqlErrors = resp.data?.errors?.map((e) => e.message) || [];
    const rateLimitMessage = gqlErrors.find(isTwentyRateLimitError);

    if ((resp.status === 429 || rateLimitMessage) && attempt < maxAttempts - 1) {
      const waitMs = rateLimitMessage
        ? parseTwentyRateLimitWaitMs(rateLimitMessage)
        : config.twentyApiRateLimitWindowMs;
      logTwenty('warn', 'gql rate limited, retrying', {
        operation,
        attempt: attempt + 1,
        maxAttempts,
        waitMs,
        httpStatus: resp.status,
      });
      await delay(waitMs);
      return gql(apiUrl, apiToken, query, variables, attempt + 1);
    }

    logTwenty('info', 'gql request done', {
      operation,
      attempt: attempt + 1,
      durationMs,
      httpStatus: resp.status,
      gqlErrors: gqlErrors.length ? gqlErrors : undefined,
    });

    return resp;
  } catch (err) {
    const durationMs = Date.now() - startedAt;

    if (isTimeoutError(err) && attempt < maxAttempts - 1) {
      const waitMs = 2000 * (attempt + 1);
      logTwenty('warn', 'gql timeout, retrying', {
        operation,
        attempt: attempt + 1,
        maxAttempts,
        durationMs,
        waitMs,
        apiUrl,
      });
      await delay(waitMs);
      return gql(apiUrl, apiToken, query, variables, attempt + 1);
    }

    logTwenty('error', 'gql request failed', {
      operation,
      attempt: attempt + 1,
      maxAttempts,
      durationMs,
      apiUrl,
      error: err.message,
      code: err.code,
      variables: summarizeGqlVariables(variables),
    });

    if (isTimeoutError(err)) {
      throw new Error(
        `Twenty API timeout on ${operation} after ${maxAttempts} attempts (${timeoutMs}ms each, apiUrl=${apiUrl})`
      );
    }

    throw new Error(`${operation}: ${err.message || 'Twenty API request failed'}`);
  }
}

export function createTwentyGqlClient(apiUrl, apiToken) {
  return (query, variables = {}) => gql(apiUrl, apiToken, query, variables);
}
