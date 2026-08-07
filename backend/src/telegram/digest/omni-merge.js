import { RISK_LIST_LIMIT } from './compute.js';

export const OMNI_CANDIDATE_LIMIT = 20;

export function pickOmniCandidates(risks) {
  return (risks ?? []).slice(0, OMNI_CANDIDATE_LIMIT);
}

export function applyOmniEnrichment(digestModel, omniResult) {
  const base = digestModel?.risks ?? [];
  const notes = omniResult?.notes?.length ? [...omniResult.notes] : [];
  const omniRisks = omniResult?.risks ?? [];
  if (!omniRisks.length) {
    return { risks: base, notes };
  }
  const byId = new Map(base.map((r) => [r.opportunityId, r]));
  const used = new Set();
  const ordered = [];
  for (const item of omniRisks) {
    const full = byId.get(item.opportunityId);
    if (!full || used.has(item.opportunityId)) continue;
    used.add(item.opportunityId);
    const next = { ...full };
    if (item.reason) next.reason = item.reason;
    ordered.push(next);
  }
  for (const r of base) {
    if (ordered.length >= RISK_LIST_LIMIT) break;
    if (used.has(r.opportunityId)) continue;
    used.add(r.opportunityId);
    ordered.push({ ...r });
  }
  return { risks: ordered, notes };
}
