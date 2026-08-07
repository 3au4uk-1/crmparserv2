/** Tony-style: prefix/dates/manager/bookingNo/... */
export function parseDealNameParts(name) {
  const parts = String(name || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 4 && /^\d{4,}$/.test(parts[3])) {
    return { manager: parts[2], bookingNo: parts[3] };
  }
  return { manager: '', bookingNo: '' };
}
