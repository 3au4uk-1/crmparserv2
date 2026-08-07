import { describe, expect, it, vi } from 'vitest';
import { enrichDigestWithOmni } from '../src/telegram/digest/omni.js';

describe('enrichDigestWithOmni', () => {
  it('calls primary then fallback on 500', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  risks: [{ opportunityId: 'a', reason: 'r' }],
                  notes: [],
                }),
              },
            },
          ],
        }),
      });
    const result = await enrichDigestWithOmni({
      config: {
        enabled: true,
        baseUrl: 'https://omni.test/v1',
        apiKey: 'k',
        model: 'oc/deepseek-v4-flash-free',
        fallbackModel: 'auto',
        timeoutMs: 10_000,
      },
      dayMeta: { title: 'ЗАВТРА', dateLabel: '07.08' },
      digestModel: { ready: {}, notReady: {}, totalDeals: 1, totalPositions: 1 },
      candidates: [
        {
          opportunityId: 'a',
          ready: 0,
          total: 2,
          amountRubles: 1,
          labels: ['риск'],
          score: 3,
          companyName: 'A',
        },
      ],
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('oc/deepseek-v4-flash-free');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('auto');
    expect(result.risks[0].opportunityId).toBe('a');
  });

  it('returns null when disabled', async () => {
    const fetchImpl = vi.fn();
    expect(
      await enrichDigestWithOmni({
        config: { enabled: false, baseUrl: '', apiKey: '', model: '', fallbackModel: '', timeoutMs: 1 },
        dayMeta: {},
        digestModel: {},
        candidates: [],
        fetchImpl,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
