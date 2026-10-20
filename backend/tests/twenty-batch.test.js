import { describe, it, expect, vi } from 'vitest';
import {
  chunk,
  TWENTY_BATCH_SIZE,
  createDealLineItemsBatch,
  deleteDealLineItemsBatch,
  upsertDealLineItemsBatch,
  isSchemaBatchError,
  dealLineItemUpsertSupported,
  resetDealLineItemUpsertSupport,
  setDealLineItemUpsertSupport,
} from '../src/services/twenty-batch.js';

describe('chunk', () => {
  it('splits to 60', () => {
    const items = Array.from({ length: 61 }, (_, i) => i);
    const parts = chunk(items, TWENTY_BATCH_SIZE);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(60);
    expect(parts[1]).toHaveLength(1);
  });
});

describe('createDealLineItemsBatch', () => {
  it('sends one mutation and maps ids by index', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { createDealLineItems: [{ id: 'a' }, { id: 'b' }] } },
    });
    const ids = await createDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      inputs: [{ name: 'A' }, { name: 'B' }],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    });
    expect(ids.map((x) => x.id)).toEqual(['a', 'b']);
    expect(gql).toHaveBeenCalledTimes(1);
    expect(gql.mock.calls[0][2]).toMatch(/createDealLineItems/);
  });

  it('fails the deal when response length mismatches', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { createDealLineItems: [{ id: 'a' }] } },
    });
    await expect(createDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      inputs: [{ name: 'A' }, { name: 'B' }],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    })).rejects.toThrow(/length/);
  });
});

describe('upsertDealLineItemsBatch', () => {
  it('does not use updateMany with a single shared body', async () => {
    setDealLineItemUpsertSupport(true);
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { upsertDealLineItems: [{ id: '1' }, { id: '2' }] } },
    });
    await upsertDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      rows: [
        { id: '1', data: { amount: { amountMicros: 1, currencyCode: 'RUB' } } },
        { id: '2', data: { amount: { amountMicros: 2, currencyCode: 'RUB' } } },
      ],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      allowAliasFallback: false,
    });
    const query = gql.mock.calls[0][2];
    expect(query).toMatch(/upsertDealLineItems/);
    expect(query).not.toMatch(/updateDealLineItems\(/);
  });

  it('uses per-record updates when the schema has no upsert mutation', async () => {
    resetDealLineItemUpsertSupport();
    const gql = vi.fn().mockImplementation((_url, _token, query) => {
      if (String(query).includes('DealLineItemWriteCapability')) {
        return Promise.resolve({
          status: 200,
          data: { data: { upsertInput: null, mutationFields: { fields: [{ name: 'updateDealLineItem' }] } } },
        });
      }
      return Promise.resolve({
        status: 200,
        data: { data: { updateDealLineItem: { id: 'ok' } } },
      });
    });
    await upsertDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      rows: [
        { id: '1', data: { kolichestvo: 1 } },
        { id: '2', data: { kolichestvo: 2 } },
      ],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    });
    const queries = gql.mock.calls.map((call) => call[2]);
    expect(queries[0]).toMatch(/DealLineItemWriteCapability/);
    expect(queries.some((query) => /upsertDealLineItems/.test(query))).toBe(false);
    expect(queries.filter((query) => /updateDealLineItem\(/.test(query))).toHaveLength(2);
    expect(gql.mock.calls[1][3]).toEqual({ id: '1', data: { kolichestvo: 1 } });
    expect(gql.mock.calls[2][3]).toEqual({ id: '2', data: { kolichestvo: 2 } });
  });

  it('caches a supported upsert and does not probe again', async () => {
    resetDealLineItemUpsertSupport();
    const gql = vi.fn().mockImplementation((_url, _token, query) => {
      if (String(query).includes('DealLineItemWriteCapability')) {
        return Promise.resolve({
          status: 200,
          data: {
            data: {
              upsertInput: { name: 'DealLineItemUpsertInput' },
              mutationFields: { fields: [{ name: 'upsertDealLineItems' }] },
            },
          },
        });
      }
      return Promise.resolve({
        status: 200,
        data: { data: { upsertDealLineItems: [{ id: '1' }] } },
      });
    });
    const args = {
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      rows: [{ id: '1', data: { kolichestvo: 1 } }],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    };
    await upsertDealLineItemsBatch(args);
    await upsertDealLineItemsBatch(args);
    const probes = gql.mock.calls.filter((call) => String(call[2]).includes('DealLineItemWriteCapability'));
    expect(probes).toHaveLength(1);
    expect(gql.mock.calls.filter((call) => /upsertDealLineItems/.test(call[2]))).toHaveLength(2);
    expect(dealLineItemUpsertSupported({
      upsertInput: { name: 'DealLineItemUpsertInput' },
      mutationFields: { fields: [{ name: 'upsertDealLineItems' }] },
    })).toBe(true);
    expect(dealLineItemUpsertSupported({ upsertInput: null, mutationFields: { fields: [] } })).toBe(false);
  });

  it('falls back to one updateDealLineItem per request on schema error', async () => {
    setDealLineItemUpsertSupport(true);
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error('Cannot query field upsertDealLineItems'))
      .mockResolvedValue({
        status: 200,
        data: { data: { updateDealLineItem: { id: 'ok' } } },
      });
    await upsertDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      rows: [
        { id: '1', data: { kolichestvo: 1 } },
        { id: '2', data: { kolichestvo: 2 } },
      ],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      allowAliasFallback: true,
    });
    expect(gql).toHaveBeenCalledTimes(3);
    const updateQueries = gql.mock.calls.slice(1).map((c) => c[2]);
    for (const query of updateQueries) {
      expect(query).toMatch(/updateDealLineItem\(/);
      expect((query.match(/updateDealLineItem/g) || []).length).toBe(1);
    }
    expect(gql.mock.calls[1][3]).toEqual({ id: '1', data: { kolichestvo: 1 } });
    expect(gql.mock.calls[2][3]).toEqual({ id: '2', data: { kolichestvo: 2 } });
  });
});

describe('isSchemaBatchError', () => {
  it('is true for missing field, false for 429', () => {
    expect(isSchemaBatchError(new Error('Cannot query field upsertDealLineItems'))).toBe(true);
    expect(isSchemaBatchError(new Error('Limit reached (100 tokens per 60000 ms)'))).toBe(false);
  });

  it('is true for unknown upsert input type', () => {
    expect(isSchemaBatchError(new Error('Unknown type "DealLineItemUpsertInput"'))).toBe(true);
  });

  it('is true for HTTP 400 schema errors and false for 5xx', () => {
    expect(isSchemaBatchError(new Error('Twenty API error: HTTP 400'))).toBe(true);
    expect(isSchemaBatchError(Object.assign(new Error('bad request'), { status: 400 }))).toBe(true);
    expect(isSchemaBatchError(new Error('Twenty API error: HTTP 500'))).toBe(false);
  });
});
