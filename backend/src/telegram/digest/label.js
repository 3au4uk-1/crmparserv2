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

export function bookingNoFromTonyUrl(url) {
  const m = String(url || '').match(/[?&]id=(\d{5,})/i);
  return m ? m[1] : '';
}

export function bookingNoFromName(name) {
  const m = String(name || '').match(/\d{5,}/);
  return m ? m[0] : '';
}

export function resolveBookingNo({ tonyUrl, name } = {}) {
  return bookingNoFromTonyUrl(tonyUrl) || bookingNoFromName(name) || '';
}

export function twentyOpportunityUrl(apiUrl, opportunityId) {
  const id = String(opportunityId || '').trim();
  if (!id) return '';
  try {
    const origin = new URL(String(apiUrl || '').trim()).origin;
    if (!origin || origin === 'null') return '';
    return `${origin}/object/opportunity/${id}`;
  } catch {
    return '';
  }
}
