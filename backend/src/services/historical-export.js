import ExcelJS from 'exceljs';
import { classifyByKeywords } from './classifier.js';
import { isBlacklisted } from './blacklist.js';
import { parseDealTitle } from './title-parser.js';
import { desiredDealKeys } from './tony-reconcile.js';
import { buildTonyDealFields, buildTonyItems } from './tony-mapping.js';
import { toInputDate, parseEventDate, isEventInRange, normalizeExportRange } from '../utils/crm-dates.js';
import { authenticate } from './auth.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchEvents, fetchEventData, prefetchAll } from './parser.js';
import { loadCompanyCodes } from './companies.js';
import { loadBlacklist } from './blacklist.js';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { createPool } from './fetch-pool.js';
import { setExportJobFile, updateExportJob } from './export-jobs.js';
import { releaseParsingLock } from './parsing-lock.js';

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

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

export async function runHistoricalExport(jobId, { from, to, company }) {
  const { start, end } = normalizeExportRange(from, to);
  updateExportJob(jobId, { status: 'running' });

  try {
    await authenticate();

    let tonyReady = false;
    const tonyCfg = getTonyConfig();
    if (tonyCfg.login && tonyCfg.password) {
      try {
        await tonyLogin();
        tonyReady = true;
      } catch (err) {
        console.warn(`[tony] login failed, falling back to calendar for export: ${err.message}`);
      }
    }

    const db = getDb();
    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const blacklist = loadBlacklist(db);
    const knownCodes = loadCompanyCodes(db);

    const events = (await fetchEvents(start, end))
      .filter((event) => isEventInRange(event, start, end))
      .sort((a, b) => {
        const da = parseEventDate(a.start ?? a.start_date)?.getTime() ?? 0;
        const db = parseEventDate(b.start ?? b.start_date)?.getTime() ?? 0;
        return da - db;
      });

    updateExportJob(jobId, {
      progress: { eventsTotal: events.length, eventsDone: 0, dealsMatched: 0 },
    });

    let prefetched = null;
    if (config.parsePipeline === 'parallel') {
      const run = createPool({ concurrency: config.fetchConcurrency });
      prefetched = await prefetchAll(events, tonyReady, start, end, run);
    }

    const allDeals = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      const data = prefetched
        ? prefetched.get(eventId)
        : await fetchEventData(event, eventId, tonyReady);

      if (!data) {
        updateExportJob(jobId, { progress: { eventsDone: i + 1 } });
        continue;
      }

      const deals = buildExportDealsFromEvent(
        event,
        eventId,
        data,
        knownCodes,
        keywords,
        blacklist,
        company || null
      );
      allDeals.push(...deals);

      updateExportJob(jobId, {
        progress: { eventsDone: i + 1, dealsMatched: allDeals.length },
      });
    }

    const buffer = await buildExportWorkbook(allDeals, from, to);
    setExportJobFile(jobId, buffer);
    updateExportJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    updateExportJob(jobId, {
      status: 'failed',
      error: err.message,
      completedAt: new Date().toISOString(),
    });
    throw err;
  } finally {
    releaseParsingLock();
  }
}
