import { config } from '../config.js';
import { createPool } from './fetch-pool.js';

export async function runDealSyncPool(
  dealIds,
  worker,
  { concurrency = config.twentySyncConcurrency, onDealSettled } = {},
) {
  const run = createPool({ concurrency });
  await Promise.all((dealIds || []).map((dealId) => run(async () => {
    try {
      const result = await worker(dealId);
      onDealSettled?.({ dealId, ok: true, result, error: null });
    } catch (error) {
      onDealSettled?.({ dealId, ok: false, result: null, error });
    }
  })));
}
