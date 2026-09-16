import { runDealSyncPool } from './deal-sync-pool.js';
import {
  syncDealToTwenty,
  cancelDealInTwenty,
  restoreDealInTwenty,
  runPrintSheetRefresh,
  setTwentySyncInFlightCaches,
  resetTwentySyncInFlightCaches,
} from './twenty-sync.js';
import { createInFlightCache } from './twenty-inflight-cache.js';
import { resetTwentyGqlCounters, getTwentyGqlCounters } from './twenty-gql.js';

export async function runPostParseTwentySync({
  resyncDealIds = [],
  cancelDealIds = [],
  restoreDealIds = [],
  autoApproveDealIds = [],
} = {}) {
  const started = Date.now();
  resetTwentyGqlCounters();
  setTwentySyncInFlightCaches({
    warehouse: createInFlightCache(),
    company: createInFlightCache(),
    person: createInFlightCache(),
  });

  let skipped_noop = 0;
  let failed = 0;
  let cancelled_ok = 0;
  let restored_ok = 0;
  const deals =
    resyncDealIds.length + cancelDealIds.length + restoreDealIds.length + autoApproveDealIds.length;

  const onSettle = ({ ok, result }) => {
    if (!ok) failed += 1;
    else if (result?.action === 'noop') skipped_noop += 1;
  };

  await runDealSyncPool(resyncDealIds, (id) => syncDealToTwenty(id, { skipPrintSheetRefresh: true }), { onDealSettled: onSettle });
  await runDealSyncPool(cancelDealIds, (id) => cancelDealInTwenty(id), {
    onDealSettled: (evt) => {
      onSettle(evt);
      if (evt.ok && evt.result && !evt.result.skipped) cancelled_ok += 1;
    },
  });
  await runDealSyncPool(restoreDealIds, (id) => restoreDealInTwenty(id), {
    onDealSettled: (evt) => {
      onSettle(evt);
      if (evt.ok && evt.result && !evt.result.skipped) restored_ok += 1;
    },
  });
  await runDealSyncPool(autoApproveDealIds, (id) => syncDealToTwenty(id, { skipPrintSheetRefresh: true }), { onDealSettled: onSettle });

  try {
    await runPrintSheetRefresh();
  } catch (err) {
    console.warn('[twenty-sync] print_sheet.refresh.failed', err.message);
  }

  const counters = getTwentyGqlCounters();
  const summary = {
    deals,
    skipped_noop,
    gql_count: counters.gqlCount,
    rate_limited: counters.rateLimitedCount,
    failed,
    duration_ms: Date.now() - started,
    cancelled_ok,
    restored_ok,
  };
  console.log(`[twenty-sync] ${new Date().toISOString()} post_parse.done ${JSON.stringify(summary)}`);
  resetTwentySyncInFlightCaches();
  return summary;
}
