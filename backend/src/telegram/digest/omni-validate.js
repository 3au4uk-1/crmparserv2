export const OMNI_REASON_MAX = 80;
export const OMNI_NOTES_MAX = 4;
export const OMNI_NOTE_MAX = 120;

function clip(s, max) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

export function validateOmniEnrichment(raw, candidateIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const risksIn = Array.isArray(raw.risks) ? raw.risks : [];
  const seen = new Set();
  const risks = [];
  for (const item of risksIn) {
    const id = String(item?.opportunityId ?? '').trim();
    if (!id || !candidateIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const reason = clip(item?.reason, OMNI_REASON_MAX);
    risks.push({ opportunityId: id, reason });
  }
  const notes = [];
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    const t = clip(n, OMNI_NOTE_MAX);
    if (!t) continue;
    notes.push(t);
    if (notes.length >= OMNI_NOTES_MAX) break;
  }
  return { risks, notes };
}
