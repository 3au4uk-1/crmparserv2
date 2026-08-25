export function extractBookingId(name) {
  if (!name) return '';
  const match = name.match(/\d{5,6}/);
  return match?.[0] ?? '';
}
