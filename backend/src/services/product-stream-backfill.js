import { normalizePattern } from './blacklist.js';
import { coerceProductStreams, productStreamsEqual } from './product-stream.js';
import { resolveItemProductStreams } from './twenty-items.js';

/**
 * @param {{
 *   parserItem?: object | null,
 *   istochnik?: string | null,
 *   existingProductStream?: unknown,
 *   streamContext?: object,
 * }} args
 * @returns {string[] | null} null → skip this Twenty row
 */
export function desiredStreamsForTwentyLineItem({
  parserItem,
  istochnik,
  existingProductStream,
  streamContext,
}) {
  const isManual =
    istochnik === 'TWENTY_RUCHNAYA'
    || parserItem?.classification === 'manual_twenty';

  if (isManual) {
    const coerced = coerceProductStreams(existingProductStream);
    return coerced.length > 0 ? coerced : ['BRANDING'];
  }

  if (parserItem) {
    return resolveItemProductStreams(parserItem, streamContext);
  }

  return null;
}

function needsProductStreamUpdate(desired, existingProductStream) {
  const coercedExisting = coerceProductStreams(existingProductStream);
  if (!productStreamsEqual(desired, coercedExisting)) return true;
  // Scalar/null must be written as MULTI_SELECT array even when set matches.
  return !Array.isArray(existingProductStream);
}

/**
 * Match PARSER items to Twenty rows by twenty_id then by normalizePattern(name)
 * (first unclaimed). No deletes or creates.
 *
 * @param {{
 *   parserItems?: object[],
 *   twentyLineItems?: object[],
 *   streamContext?: object,
 * }} args
 * @returns {{ toUpdate: { twentyId: string, productStreams: string[], name: string }[], skipped: number }}
 */
export function planProductStreamBackfill({
  parserItems = [],
  twentyLineItems = [],
  streamContext,
} = {}) {
  const existingById = new Map(twentyLineItems.map((li) => [li.id, li]));
  const claimedIds = new Set();
  const matchedPairs = []; // { parserItem, twentyLi }

  const byNameQueues = new Map();
  for (const li of twentyLineItems) {
    const key = normalizePattern(li.name);
    if (!byNameQueues.has(key)) byNameQueues.set(key, []);
    byNameQueues.get(key).push(li);
  }

  for (const item of parserItems) {
    if (item.twenty_id && existingById.has(item.twenty_id) && !claimedIds.has(item.twenty_id)) {
      const existing = existingById.get(item.twenty_id);
      claimedIds.add(existing.id);
      matchedPairs.push({ parserItem: item, twentyLi: existing });
      continue;
    }

    const key = normalizePattern(item.name);
    const queue = byNameQueues.get(key) || [];
    let matched = null;
    while (queue.length) {
      const candidate = queue.shift();
      if (claimedIds.has(candidate.id)) continue;
      matched = candidate;
      break;
    }
    if (matched) {
      claimedIds.add(matched.id);
      matchedPairs.push({ parserItem: item, twentyLi: matched });
    }
  }

  const toUpdate = [];
  let skipped = 0;

  const processedTwentyIds = new Set();

  for (const { parserItem, twentyLi } of matchedPairs) {
    processedTwentyIds.add(twentyLi.id);
    const desired = desiredStreamsForTwentyLineItem({
      parserItem,
      istochnik: twentyLi.istochnik,
      existingProductStream: twentyLi.productStream,
      streamContext,
    });

    if (desired === null) {
      skipped += 1;
      continue;
    }

    // Empty desired for a parser item: skip (do not clear Twenty).
    if (
      Array.isArray(desired)
      && desired.length === 0
      && parserItem
      && twentyLi.istochnik !== 'TWENTY_RUCHNAYA'
      && parserItem.classification !== 'manual_twenty'
    ) {
      skipped += 1;
      continue;
    }

    if (!needsProductStreamUpdate(desired, twentyLi.productStream)) {
      skipped += 1;
      continue;
    }

    toUpdate.push({
      twentyId: twentyLi.id,
      name: twentyLi.name,
      productStreams: desired,
    });
  }

  // Unmatched Twenty rows (manuals without parser match, or unmatched PARSER rows).
  for (const li of twentyLineItems) {
    if (processedTwentyIds.has(li.id)) continue;

    const desired = desiredStreamsForTwentyLineItem({
      parserItem: null,
      istochnik: li.istochnik,
      existingProductStream: li.productStream,
      streamContext,
    });

    if (desired === null) {
      skipped += 1;
      continue;
    }

    if (!needsProductStreamUpdate(desired, li.productStream)) {
      skipped += 1;
      continue;
    }

    toUpdate.push({
      twentyId: li.id,
      name: li.name,
      productStreams: desired,
    });
  }

  return { toUpdate, skipped };
}
