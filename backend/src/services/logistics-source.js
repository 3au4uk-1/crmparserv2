import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { crmOffsetSuffix, toInputDate } from '../utils/crm-dates.js';
import { dmyToIsoDate } from './tony-mapping.js';
import { getTonyConfig, isTonyAuthResponse, tonyGet } from './tony-auth.js';
import { crmFailure } from '../utils/crm-response-log.js';

const orderCache = new Map();

const LOAD_RETURN_RE = /Загрузка:\s*(\d{2}\.\d{2}\.\d{4})(?:\s+(\d{2}:\d{2}))?[\s\S]*?Возврат:\s*(\d{2}\.\d{2}\.\d{4})(?:\s+(\d{2}:\d{2}))?(?:\s*-\s*(\d{2}:\d{2}))?/i;

export function resetLogisticsCache() {
  orderCache.clear();
}

export function reserveStatusCode() {
  return String(config.logisticReserveStatus || '5').trim() || '5';
}

function normalizeLabel(value) {
  return cleanText(value).toLowerCase().replace(/ё/g, 'е');
}

function isStatusFilterName(name) {
  const n = String(name || '').replace(/\s+/g, '').toLowerCase();
  return n === 'status[]' || n.includes('status[]') || /^status\[\d*\]$/.test(n);
}

function nearbyStatusText($, input) {
  const chunks = [];
  const push = (value) => {
    if (value) chunks.push(value);
  };
  push(input.attr('aria-label'));
  push(input.attr('title'));
  push(input.attr('data-label'));
  const id = input.attr('id');
  if (id) {
    const safe = String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    push($(`label[for="${safe}"]`).text());
  }
  const wrapping = input.closest('label');
  if (wrapping.length) push(wrapping.text());

  const parent = input.parent();
  parent.contents().each((_, node) => {
    if (node === input.get(0)) return;
    if (node.type === 'text') push(node.data);
    else if (node.type === 'tag' && node.name !== 'input') push($(node).text());
  });

  let hop = input;
  for (let depth = 0; depth < 4; depth += 1) {
    hop = hop.parent();
    if (!hop.length || hop.is('body, form, html')) break;
    const boxes = hop.find('input').toArray().filter((el) => isStatusFilterName($(el).attr('name')));
    if (boxes.length === 1) push(hop.text());
  }
  return chunks.join(' ');
}

function reserveCodeFromRawHtml(html) {
  const inputRe = /<input\b[^>]*>/gi;
  let match;
  while ((match = inputRe.exec(html))) {
    const tag = match[0];
    const name = /name\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    if (!isStatusFilterName(name)) continue;
    const value = /value\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    if (!value) continue;
    const start = Math.max(0, match.index - 350);
    const end = Math.min(html.length, match.index + tag.length + 350);
    const windowText = html.slice(start, end)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ');
    if (normalizeLabel(windowText).includes('резерв')) return cleanText(value);
  }
  return '';
}

/**
 * Read the logistics filter checkbox whose label contains «резерв».
 * Falls back to LOGISTIC_STATUS, then 5, when the form has no such checkbox.
 * Card badges are not order statuses and are not consulted here.
 */
export function parseReserveStatusCode(html, fallback = reserveStatusCode()) {
  const fb = String(fallback || '5').trim() || '5';
  if (!html || typeof html !== 'string') return fb;
  const $ = cheerio.load(html);
  const matches = [];
  $('input').each((_, el) => {
    const input = $(el);
    if (!isStatusFilterName(input.attr('name'))) return;
    const value = cleanText(input.attr('value'));
    if (!value) return;
    const label = normalizeLabel(nearbyStatusText($, input));
    if (label.includes('резерв')) matches.push({ value, label });
  });
  if (!matches.length) return reserveCodeFromRawHtml(html) || fb;
  matches.sort((a, b) => a.label.length - b.label.length);
  const exact = matches.find((item) => item.label === 'в резерве' || /(^|\s)в резерве(\s|$)/.test(item.label));
  return (exact || matches[0]).value;
}

function isoToDmy(iso) {
  const [year, month, day] = String(iso || '').split('-');
  if (!year || !month || !day) return '';
  return `${day}.${month}.${year}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cleanText(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function ymdInRange(ymd, startDate, endDate) {
  if (!ymd) return false;
  const start = toInputDate(startDate);
  const end = toInputDate(endDate);
  if (!start || !end) return false;
  return ymd >= start && ymd <= end;
}

function crmIso(ymd, time) {
  const hhmm = /^\d{2}:\d{2}$/.test(time || '') ? time : '00:00';
  return `${ymd}T${hhmm}:00${crmOffsetSuffix()}`;
}

export function dealTitleFromCard(linkText, orderId) {
  const text = cleanText(linkText);
  const match = text.match(/^ID:\s*(.*)\s\/\s([^/]+)$/i);
  let title = match ? match[1].trim() : text;
  const client = match ? match[2].trim() : '';
  const id = String(orderId || '').trim();
  if (id && title && !title.includes(id)) title = `${title} ${id}`;
  if (!title && id) title = id;
  return { title, client };
}

function parseSchedule(text) {
  const match = cleanText(text).match(LOAD_RETURN_RE);
  if (!match) {
    return {
      loadDate: '', loadTime: '', returnDate: '', returnTime: '', returnEnd: '',
    };
  }
  return {
    loadDate: dmyToIsoDate(match[1]),
    loadTime: match[2] || '',
    returnDate: dmyToIsoDate(match[3]),
    returnTime: match[4] || '',
    returnEnd: match[5] || '',
  };
}

function parseContact(text) {
  const line = cleanText(text);
  const withMarks = line.match(/👤\s*(.*?)\s*\|\s*☎\s*(.+)$/);
  if (withMarks) return { name: withMarks[1].trim(), phone: withMarks[2].trim() };
  const plain = line.match(/^([^|]+)\|(.+)$/);
  if (plain && /\d{5,}/.test(plain[2])) {
    return { name: plain[1].trim(), phone: plain[2].trim() };
  }
  return { name: '', phone: '' };
}

/**
 * Parse one logistics list page into order cards.
 * Throws when the body is not a logistics page (the failure includes a masked snippet).
 */
export function parseLogisticList(html, resp = {}) {
  const body = typeof html === 'string' ? html : '';
  if (isTonyAuthResponse({ status: resp.status ?? 200, headers: resp.headers, data: body })) {
    throw crmFailure('logistics', 'Logistics session is not authorized', { ...resp, data: body });
  }
  const recognizable = /order-card/i.test(body) || /name=["']date_range/i.test(body) || /date_range2/i.test(body);
  if (!recognizable) {
    throw crmFailure('logistics', 'Logistics page returned an unexpected body', { ...resp, data: body });
  }

  const $ = cheerio.load(body);
  const orders = [];
  const seen = new Set();
  $('.order-card').each((_, el) => {
    const card = $(el);
    const id = cleanText(card.attr('data-order-id'));
    if (!id || seen.has(id)) return;
    seen.add(id);
    const link = card.find('.card-header .ref a').first();
    const href = link.attr('href') || '';
    const linkText = cleanText(link.text());
    const { title, client } = dealTitleFromCard(linkText, id);
    const schedule = parseSchedule(card.find('.order-info-line').text());
    const contactLine = card.find('.order-info-line').filter((__, node) => /👤|☎|\|/.test($(node).text())).first().text();
    const contact = parseContact(contactLine);
    const address = cleanText(card.find('.order-info-line-address').attr('title') || card.find('.order-info-line-address').text());
    const statusLabel = cleanText(card.find('.status-indicator').first().text());
    const statusCode = cleanText(card.attr('data-order-status') || card.find('.status-indicator').attr('data-status'));
    const warehouses = card.find('.logistic-warehouse-status-line').map((__, node) => cleanText($(node).text())).get().filter(Boolean);
    orders.push({
      id,
      dealId: cleanText(card.attr('data-deal-id')),
      href,
      title,
      client,
      ...schedule,
      contactName: contact.name,
      contactPhone: contact.phone,
      address,
      statusLabel,
      statusCode,
      paymentText: cleanText(card.find('.fact-of-payment').first().text()),
      bitrixStage: cleanText(card.find('.bitrix-stage-label').first().text()),
      warehouses,
    });
  });
  return orders;
}

const RESERVE_DEAL_STATUS = 'В резерве';

/** One calendar event when the load day or the return day falls in the range. Middle days are skipped. */
export function toCalendarEvent(order, startDate, endDate) {
  const loadIn = ymdInRange(order.loadDate, startDate, endDate);
  const returnIn = ymdInRange(order.returnDate, startDate, endDate);
  if (!loadIn && !returnIn) return null;

  const startYmd = loadIn ? order.loadDate : order.returnDate;
  const startTime = loadIn ? order.loadTime : (order.returnTime || order.returnEnd);
  const endYmd = order.returnDate || order.loadDate;
  const endTime = order.returnEnd || order.returnTime || order.loadTime;

  return {
    original_id: String(order.id),
    id: String(order.id),
    leadid: order.dealId || '',
    title: order.title || String(order.id),
    start: crmIso(startYmd, startTime),
    end: crmIso(endYmd, endTime),
  };
}

/**
 * Every card on the page is already a reserve order: /logistic/ is requested
 * with status[] set to «В резерве». Card badges (new / in_progress / done)
 * are the logistics line status and must not drop the order.
 */
export function selectLogisticEvents(orders, startDate, endDate) {
  const events = [];
  for (const order of orders) {
    if (!order.loadDate && !order.returnDate) {
      console.warn(`[logistics] order ${order.id} has no load or return date; skipped`);
      continue;
    }
    const event = toCalendarEvent(order, startDate, endDate);
    if (!event) continue;
    events.push(event);
  }
  return events;
}

function headerName(text) {
  return /^(название|наименование|товар|позиция|№)$/i.test(cleanText(text));
}

function parseTonyRows($) {
  const items = [];
  $('tr[data-id]').each((_, tr) => {
    const row = $(tr);
    if (row.hasClass('order_separator') || row.hasClass('spacer-row')) return;
    const name = cleanText(
      row.find('.custom_name_value').first().attr('value')
      || row.find('.custom_name_title, .item_name_link').first().text(),
    );
    if (!name) return;
    const quantity = cleanText(row.find('.orders_custom_edit, input.orders_edit').first().attr('value'));
    const price = cleanText(row.attr('data-price') || row.find('.price_value').attr('value'));
    const discount = cleanText(row.find('.discount_value').attr('value') || '0');
    items.push({ name, quantity, price, discount });
  });
  return items;
}

/** Position names and quantities from an act (or an orders_edit table, if that markup is present). */
export function parseActPositions(html) {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const tonyRows = parseTonyRows($);
  if (tonyRows.length) return tonyRows;

  const items = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td').map((__, cell) => cleanText($(cell).text())).get();
    if (cells.length < 2) return;
    const name = cells[0];
    if (!name || headerName(name) || name.toLowerCase().startsWith('итого')) return;
    let quantity = '';
    let price = '';
    let discount = '0';
    const rest = cells.slice(1);
    for (const cell of rest) {
      if (!quantity && /^\d+([.,]\d+)?(\s*шт\.?)?$/i.test(cell)) {
        quantity = cell;
        continue;
      }
      if (!price && /\d/.test(cell)) {
        price = cell;
        continue;
      }
      if (price && discount === '0' && /\d/.test(cell)) discount = cell;
    }
    items.push({ name, quantity, price, discount });
  });
  return items;
}

function describedLine(label, value) {
  const text = cleanText(value);
  if (!text) return null;
  return `${label}: ${esc(text)}`;
}

export function buildDescriptionHtml(order, positions) {
  const lines = [
    describedLine('Статус сделки', order.dealStatus || RESERVE_DEAL_STATUS),
    describedLine('Контактное лицо', order.contactName),
    describedLine('Компания', order.client),
    describedLine('Контактный телефон', order.contactPhone),
    describedLine('Адрес проведения', order.address),
    describedLine('Время приезда', order.loadTime),
    describedLine('Время работы', [order.returnTime, order.returnEnd].filter(Boolean).join(' - ')),
    describedLine('Время демонтажа', order.returnEnd || order.returnTime),
  ].filter(Boolean);
  if (order.bitrixStage) lines.push(`Bitrix: ${esc(order.bitrixStage)}`);
  if (order.paymentText) lines.push(`Оплата: ${esc(order.paymentText)}`);
  for (const warehouse of order.warehouses || []) {
    lines.push(`Склад: ${esc(warehouse)}`);
  }
  const rows = (positions || []).map((item) => (
    `<tr><td>${esc(item.name)}</td><td>${esc(item.price || '')}</td><td>${esc(item.quantity || '')}</td><td>${esc(item.discount || '0')}</td></tr>`
  )).join('');
  return `<p>${lines.join('\n')}</p><table class="table-caption"><tbody>${rows}</tbody></table>`;
}

function bodyText(data) {
  if (typeof data === 'string') return data;
  if (data == null) return '';
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function requestLogisticList(startDate, endDate, statusCode) {
  const { baseUrl } = getTonyConfig();
  const params = new URLSearchParams();
  params.set('date_range', isoToDmy(toInputDate(startDate)));
  params.set('date_range2', isoToDmy(toInputDate(endDate)));
  params.set('company', '0');
  params.append('status[]', String(statusCode));
  const url = `${baseUrl}/logistic/?${params.toString()}`;
  const resp = await tonyGet(url);
  return { resp, html: bodyText(resp.data) };
}

export async function fetchLogisticEvents(startDate, endDate) {
  const fallback = reserveStatusCode();
  let statusCode = fallback;
  let page = await requestLogisticList(startDate, endDate, statusCode);
  const parsedCode = parseReserveStatusCode(page.html, fallback);
  if (parsedCode !== statusCode) {
    statusCode = parsedCode;
    page = await requestLogisticList(startDate, endDate, statusCode);
  }
  const orders = parseLogisticList(page.html, page.resp);
  for (const order of orders) order.dealStatus = RESERVE_DEAL_STATUS;
  orderCache.clear();
  const events = selectLogisticEvents(orders, startDate, endDate);
  for (const event of events) {
    const order = orders.find((item) => String(item.id) === event.id);
    if (order) orderCache.set(event.id, order);
  }
  return events;
}

export async function fetchLogisticDescription(eventId) {
  const { baseUrl } = getTonyConfig();
  const url = `${baseUrl}/orders/orders_act/?id=${encodeURIComponent(eventId)}`;
  const resp = await tonyGet(url);
  const html = bodyText(resp.data);
  if (isTonyAuthResponse(resp) || isTonyAuthResponse({ status: resp.status, headers: resp.headers, data: html })) {
    throw crmFailure('logistics', `Order ${eventId} act is not authorized`, { ...resp, data: html });
  }
  const positions = parseActPositions(html);
  const hasTable = /<table\b/i.test(html) || /data-id=/i.test(html);
  if (!positions.length && !hasTable) {
    crmFailure('logistics', `Order ${eventId} act had no position table`, { ...resp, data: html });
  }
  const order = orderCache.get(String(eventId)) || { id: String(eventId), dealStatus: RESERVE_DEAL_STATUS };
  return {
    description: buildDescriptionHtml(order, positions),
    payments: null,
  };
}
