const BS_INTERNAL_RE = /^БС\/(\d{5,7})(?=[.\s])/;

function dedupeOrdered(numbers) {
  const seen = new Set();
  const result = [];
  for (const n of numbers) {
    if (!seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  return result;
}

/** Extract all 5-7 digit booking numbers from a deal title, de-duplicated, order preserved. */
export function extractBookingNumbers(title) {
  if (!title) return [];

  const s = String(title);
  const bsInternal = s.match(BS_INTERNAL_RE)?.[1] ?? null;
  const found = [];

  let m;
  const hashRe = /#(\d{5,7})\b/g;
  while ((m = hashRe.exec(s)) !== null) {
    found.push({ num: m[1], index: m.index });
  }

  const plainRe = /\b(\d{5,7})\b/g;
  while ((m = plainRe.exec(s)) !== null) {
    const num = m[1];
    const endIndex = m.index + num.length;
    if (s[endIndex] === '.') continue;
    if (m.index > 0 && s[m.index - 1] === '#') continue;
    if (num === bsInternal) continue;
    found.push({ num, index: m.index });
  }

  found.sort((a, b) => a.index - b.index);
  return dedupeOrdered(found.map((f) => f.num));
}
