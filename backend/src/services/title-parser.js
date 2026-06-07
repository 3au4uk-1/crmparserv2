const KNOWN_COMPANIES = ['ПРО', 'АРТ', 'АРЕНДА'];

export function extractTonyOrderId(title) {
  if (!title) return null;
  const matches = title.match(/\b(\d{5,7})\b/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

export function parseDealTitle(title) {
  if (!title || !title.includes('/')) {
    return { companyCode: null, managerName: null, tonyOrderId: null, parseError: true, rawTitle: title };
  }

  const segments = title.split('/').map(s => s.trim()).filter(Boolean);

  if (segments.length < 2) {
    return { companyCode: null, managerName: null, tonyOrderId: null, parseError: true, rawTitle: title };
  }

  const companyCode = segments[0];
  const managerName = segments[segments.length - 1];

  const isKnownCompany = KNOWN_COMPANIES.includes(companyCode);

  return {
    companyCode: isKnownCompany ? companyCode : companyCode,
    managerName,
    tonyOrderId: extractTonyOrderId(title),
    parseError: !isKnownCompany,
    rawTitle: title,
  };
}
