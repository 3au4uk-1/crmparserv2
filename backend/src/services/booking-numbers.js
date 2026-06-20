/** Extract all 5-7 digit booking numbers from a deal title, de-duplicated, order preserved. */
export function extractBookingNumbers(title) {
  if (!title) return [];
  const matches = String(title).match(/\b\d{5,7}\b/g) || [];
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      result.push(m);
    }
  }
  return result;
}
