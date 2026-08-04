import { normalizePattern } from './blacklist.js';

const FREE_ENTRY_RE = /свободная запись/i;
const DISAMBIG_SUFFIX_RE = / \((#\d+)\)$/;

export function isFreeEntryTemplateName(name) {
  return FREE_ENTRY_RE.test(name ?? '');
}

function commentToLineItemName(kommentariy) {
  const text = String(kommentariy ?? '').trim();
  if (!text) return null;
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? '';
  return firstLine || null;
}

export function planTwentyFreeEntryRename(li) {
  if (!isFreeEntryTemplateName(li?.name)) return null;
  const name = commentToLineItemName(li.kommentariy);
  if (!name) return null;
  return { id: li.id, name, kommentariy: '' };
}

function getBaseName(name) {
  const trimmed = String(name ?? '').trim();
  const match = trimmed.match(/^(.+?) \((#\d+)\)$/);
  return match ? match[1] : trimmed;
}

function compareLineItems(a, b) {
  const aTime = a.createdAt ?? '';
  const bTime = b.createdAt ?? '';
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  const aId = String(a.id ?? '');
  const bId = String(b.id ?? '');
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function planTwentyNameDisambiguation(lineItems) {
  const sorted = [...lineItems].sort(compareLineItems);
  const groups = new Map();

  for (const item of sorted) {
    const base = getBaseName(item.name);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(item);
  }

  const plan = [];
  for (const items of groups.values()) {
    if (items.length <= 1) continue;
    items.forEach((item, index) => {
      const base = getBaseName(items[0].name);
      const expected =
        index === 0 ? base : `${base} (#${index + 1})`;
      const current = String(item.name ?? '').trim();
      if (current === expected) return;
      if (index > 0 && DISAMBIG_SUFFIX_RE.test(current)) return;
      plan.push({ id: item.id, name: expected });
    });
  }

  return plan;
}

function findTwentyMatch(local, twentyItems, claimedTwentyIds) {
  const localName = String(local.name ?? '').trim();
  const localBase = getBaseName(localName);

  let exact = null;
  let base = null;
  for (const twenty of twentyItems) {
    if (claimedTwentyIds.has(twenty.id)) continue;
    const twentyName = String(twenty.name ?? '').trim();
    if (twentyName === localName) {
      exact = twenty;
      break;
    }
    if (!base && getBaseName(twentyName) === localBase) {
      base = twenty;
    }
  }

  return exact ?? base ?? null;
}

export function planLocalTwentyIdUntangle(localItems, twentyItems) {
  const byTwentyId = new Map();
  for (const local of localItems) {
    if (!local.twenty_id) continue;
    if (!byTwentyId.has(local.twenty_id)) byTwentyId.set(local.twenty_id, []);
    byTwentyId.get(local.twenty_id).push(local);
  }

  const claimedTwentyIds = new Set();
  const assignments = new Map();

  for (const local of localItems) {
    const dupCount = byTwentyId.get(local.twenty_id)?.length ?? 0;
    if (dupCount <= 1) {
      assignments.set(local.id, local.twenty_id ?? null);
      if (local.twenty_id) claimedTwentyIds.add(local.twenty_id);
    }
  }

  for (const group of byTwentyId.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => {
      const lockDiff = (b.amount_locked ? 1 : 0) - (a.amount_locked ? 1 : 0);
      if (lockDiff !== 0) return lockDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const [winner, ...losers] = sorted;
    assignments.set(winner.id, winner.twenty_id);
    claimedTwentyIds.add(winner.twenty_id);

    for (const loser of losers) {
      const match = findTwentyMatch(loser, twentyItems, claimedTwentyIds);
      const nextId = match?.id ?? null;
      assignments.set(loser.id, nextId);
      if (nextId) claimedTwentyIds.add(nextId);
    }
  }

  const plan = [];
  for (const local of localItems) {
    if (!assignments.has(local.id)) continue;
    const nextId = assignments.get(local.id);
    if (nextId !== (local.twenty_id ?? null)) {
      plan.push({ localId: local.id, twenty_id: nextId });
    }
  }

  for (const local of localItems) {
    const dupCount = byTwentyId.get(local.twenty_id)?.length ?? 0;
    if (dupCount <= 1) continue;
    const nextId = assignments.get(local.id);
    if (nextId === local.twenty_id && !plan.some((p) => p.localId === local.id)) {
      plan.push({ localId: local.id, twenty_id: nextId });
    }
  }

  return plan;
}

function hasDuplicateNormalizedNames(items) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizePattern(item.name);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) >= 2) return true;
  }
  return false;
}

function hasDuplicateTwentyIds(localItems) {
  const seen = new Set();
  for (const item of localItems) {
    if (!item.twenty_id) continue;
    if (seen.has(item.twenty_id)) return true;
    seen.add(item.twenty_id);
  }
  return false;
}

export function dealNeedsFreeEntryRepair({ localItems, twentyItems }) {
  const locals = localItems ?? [];
  const twenties = twentyItems ?? [];

  if (locals.some((item) => isFreeEntryTemplateName(item.name))) return true;
  if (twenties.some((item) => isFreeEntryTemplateName(item.name))) return true;
  if (hasDuplicateTwentyIds(locals)) return true;
  if (hasDuplicateNormalizedNames(locals)) return true;
  if (hasDuplicateNormalizedNames(twenties)) return true;
  return false;
}
