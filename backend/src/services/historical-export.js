import { classifyByKeywords } from './classifier.js';
import { isBlacklisted } from './blacklist.js';
import { parseDealTitle } from './title-parser.js';
import { desiredDealKeys } from './tony-reconcile.js';
import { buildTonyDealFields, buildTonyItems } from './tony-mapping.js';

export function filterExportItems(items, blacklist = []) {
  return items.filter(
    (item) => item.classification === 'keyword_match' && !isBlacklisted(item.name, blacklist)
  );
}

export function buildExportDealsFromEvent(
  event,
  eventId,
  data,
  knownCodes,
  keywords,
  blacklist,
  companyFilter = null
) {
  const { calParsed, tonyOrders, bookingNumbers } = data;
  const titleInfo = parseDealTitle(event.title || '', knownCodes);
  if (companyFilter && titleInfo.companyCode !== companyFilter) return [];

  const targets = desiredDealKeys(eventId, bookingNumbers);
  const deals = [];

  for (const target of targets) {
    const order = target.bookingNumber ? tonyOrders.get(target.bookingNumber) : undefined;
    let classified;
    let start_date;
    let budget;

    if (order?.items?.length) {
      classified = classifyByKeywords(buildTonyItems(order), keywords);
      if (order.dates) {
        const fields = buildTonyDealFields(order);
        start_date = fields.start_date;
        budget = fields.budget;
      } else {
        start_date = order.start_date ?? event.start ?? event.start_date;
        budget = order.budget ?? null;
      }
    } else {
      if (!calParsed?.items?.length) continue;
      classified = classifyByKeywords(calParsed.items, keywords);
      start_date = event.start ?? event.start_date;
      budget = calParsed.meta?.budget ?? null;
    }

    const items = filterExportItems(classified, blacklist);
    if (items.length === 0) continue;

    deals.push({
      exportId: target.dealKey,
      title: event.title || '',
      company_code: titleInfo.companyCode,
      manager_name: titleInfo.managerName,
      start_date,
      budget,
      items,
    });
  }

  return deals;
}
