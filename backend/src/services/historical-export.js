import ExcelJS from 'exceljs';
import { classifyByKeywords } from './classifier.js';
import { isBlacklisted } from './blacklist.js';
import { parseDealTitle } from './title-parser.js';
import { desiredDealKeys } from './tony-reconcile.js';
import { buildTonyDealFields, buildTonyItems } from './tony-mapping.js';
import { toInputDate, parseEventDate } from '../utils/crm-dates.js';

function formatExportDate(iso) {
  const d = toInputDate(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

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

export async function buildExportWorkbook(deals, from, to) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Parser';
  const dealsSheet = wb.addWorksheet('Сделки');
  const itemsSheet = wb.addWorksheet('Позиции');

  const dealHeaders = ['Дата начала', 'Название', 'Компания', 'Менеджер', 'Бюджет'];
  const itemHeaders = ['ID сделки', 'Название сделки', 'Позиция', 'Цена', 'Количество', 'Сумма'];

  dealsSheet.addRow(dealHeaders).font = { bold: true };
  itemsSheet.addRow(itemHeaders).font = { bold: true };

  const sorted = [...deals].sort(
    (a, b) =>
      (parseEventDate(b.start_date)?.getTime() ?? 0) - (parseEventDate(a.start_date)?.getTime() ?? 0)
  );

  for (const deal of sorted) {
    dealsSheet.addRow([
      formatExportDate(deal.start_date),
      deal.title,
      deal.company_code,
      deal.manager_name,
      deal.budget,
    ]);
    for (const item of deal.items) {
      itemsSheet.addRow([
        deal.exportId,
        deal.title,
        item.name,
        item.price,
        item.quantity,
        item.sum,
      ]);
    }
  }

  dealsSheet.columns.forEach((col) => {
    col.width = 18;
  });
  itemsSheet.columns.forEach((col) => {
    col.width = 18;
  });

  return wb.xlsx.writeBuffer();
}
