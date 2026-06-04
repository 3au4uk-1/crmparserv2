const KNOWN_COMPANIES = ['ПРО', 'АРТ', 'АРЕНДА'];

export function parseDealTitle(title) {
  if (!title || !title.includes('/')) {
    return { companyCode: null, managerName: null, parseError: true, rawTitle: title };
  }

  const segments = title.split('/').map(s => s.trim()).filter(Boolean);

  if (segments.length < 2) {
    return { companyCode: null, managerName: null, parseError: true, rawTitle: title };
  }

  const companyCode = segments[0];
  const managerName = segments[segments.length - 1];

  const isKnownCompany = KNOWN_COMPANIES.includes(companyCode);

  return {
    companyCode: isKnownCompany ? companyCode : companyCode,
    managerName,
    parseError: !isKnownCompany,
    rawTitle: title,
  };
}
