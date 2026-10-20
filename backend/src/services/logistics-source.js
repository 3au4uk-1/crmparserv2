import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { crmOffsetSuffix, toInputDate } from '../utils/crm-dates.js';
import { dmyToIsoDate, disambiguateDuplicateNames, normalizeFreeEntryItem } from './tony-mapping.js';
import { isUnknownFactOfPayment, mapFactOfPayment } from './payment-field-names.js';
import { getTonyConfig, isTonyAuthResponse, tonyGet } from './tony-auth.js';
import { crmFailure } from '../utils/crm-response-log.js';

const orderCache = new Map();

const LOAD_RETURN_RE = /Загрузка:\s*(\d{2}\.\d{2}\.\d{4})(?:\s+(\d{2}:\d{2}))?[\s\S]*?Возврат:\s*(\d{2}\.\d{2}\.\d{4})(?:\s+(\d{2}:\d{2}))?(?:\s*-\s*(\d{2}:\d{2}))?/i;

export function resetLogisticsCache() {
  orderCache.clear();
}

const DEFAULT_BITRIX_STAGES = ['Отправили КП', 'Мероприятие подтверждено'];

export function reserveStatusCode() {
  return String(config.logisticReserveStatus || '5').trim() || '5';
}

export function fallbackOrderStatuses(raw = config.logisticStatuses, reserveCode = reserveStatusCode()) {
  const text = String(raw || '').trim();
  if (!text) {
    return [
      { label: 'В работе', code: '2' },
      { label: 'В резерве', code: String(reserveCode || '5').trim() || '5' },
    ];
  }
  const chunks = (text.includes('|') || text.includes('\n') ? text.split(/[|\n]/) : text.split(','))
    .map((part) => part.trim())
    .filter(Boolean);
  const parsed = [];
  for (const chunk of chunks) {
    const match = chunk.match(/^(.+?)\s*[=:]\s*([^\s=]+)\s*$/);
    if (!match) continue;
    parsed.push({ label: match[1].trim(), code: match[2].trim() });
  }
  if (!parsed.length) {
    return [
      { label: 'В работе', code: '2' },
      { label: 'В резерве', code: String(reserveCode || '5').trim() || '5' },
    ];
  }
  return parsed;
}

export function allowedBitrixStages(raw = config.logisticBitrixStages) {
  const text = String(raw || '').trim();
  if (!text) return [...DEFAULT_BITRIX_STAGES];
  const parts = (text.includes('|') || text.includes('\n') ? text.split(/[|\n]/) : text.split(','))
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [...DEFAULT_BITRIX_STAGES];
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

function statusLabelMatches(normalizedLabel, wantedLabel) {
  const want = normalizeLabel(wantedLabel);
  if (!want || !normalizedLabel) return false;
  if (want.includes('резерв')) return normalizedLabel.includes('резерв');
  if (want.includes('работ')) return normalizedLabel.includes('в работе');
  return normalizedLabel.includes(want);
}

function statusCandidatesFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const candidates = [];
  $('input').each((_, el) => {
    const input = $(el);
    if (!isStatusFilterName(input.attr('name'))) return;
    const value = cleanText(input.attr('value'));
    if (!value) return;
    candidates.push({ value, label: normalizeLabel(nearbyStatusText($, input)) });
  });

  const inputRe = /<input\b[^>]*>/gi;
  let match;
  while ((match = inputRe.exec(html))) {
    const tag = match[0];
    const name = /name\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    if (!isStatusFilterName(name)) continue;
    const value = cleanText(/value\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '');
    if (!value) continue;
    const after = html.slice(match.index + tag.length);
    const nextInput = after.search(/<input\b/i);
    const following = after.slice(0, nextInput === -1 ? 180 : Math.min(nextInput, 180))
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ');
    candidates.push({ value, label: normalizeLabel(following) });
  }
  return candidates;
}

function pickStatusCode(candidates, wantedLabel, fallbackCode) {
  const hits = candidates.filter((item) => statusLabelMatches(item.label, wantedLabel));
  if (!hits.length) return String(fallbackCode);
  const want = normalizeLabel(wantedLabel);
  const others = ['в работе', 'в резерве', 'новый', 'выполнен', 'отказ', 'вернулся']
    .filter((phrase) => phrase !== want);
  const focused = hits.filter((item) => !others.some((phrase) => item.label.includes(phrase)));
  const pool = focused.length ? focused : hits;
  pool.sort((a, b) => a.label.length - b.label.length);
  return pool[0].value;
}

/**
 * Codes for the order-status checkboxes we fetch.
 * Each wanted label is matched independently; a missing label keeps its fallback code.
 */
export function parseOrderStatusCodes(html, fallbacks = fallbackOrderStatuses()) {
  const candidates = statusCandidatesFromHtml(html);
  return fallbacks.map((item) => ({
    label: item.label,
    code: pickStatusCode(candidates, item.label, item.code),
  }));
}

/**
 * Read the logistics filter checkbox whose label contains «резерв».
 * Falls back to LOGISTIC_STATUS, then 5, when the form has no such checkbox.
 * Card badges are not order statuses and are not consulted here.
 */
export function parseReserveStatusCode(html, fallback = reserveStatusCode()) {
  const [reserve] = parseOrderStatusCodes(html, [{ label: 'В резерве', code: String(fallback || '5').trim() || '5' }]);
  return reserve.code;
}

export function normalizeBitrixStageName(raw) {
  return cleanText(String(raw ?? '').replace(/^\s*стадия\s+в\s+битрикс[еа]?\s*:\s*/iu, ''));
}

export function bitrixStageAllowed(stage, allowed = allowedBitrixStages()) {
  const name = normalizeLabel(normalizeBitrixStageName(stage));
  if (!name || name === '-' || name === 'нет информации') return false;
  return allowed.some((item) => normalizeLabel(item) === name);
}

export function filterOrdersByBitrixStage(orders, allowed = allowedBitrixStages()) {
  const kept = [];
  const dropped = [];
  for (const order of orders || []) {
    if (bitrixStageAllowed(order?.bitrixStage, allowed)) kept.push(order);
    else dropped.push(order);
  }
  return { kept, dropped };
}

export function droppedBitrixStageCounts(orders) {
  const counts = {};
  for (const order of orders || []) {
    const name = order?.bitrixStage || '(none)';
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
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
      bitrixStage: extractBitrixStage($, card),
      warehouses,
    });
  });
  return orders;
}

function extractBitrixStage($, card) {
  const badge = cleanText(card.find('.bitrix-stage-label, .bitrix-stage-badge, .bitrix-stage').first().text());
  const attr = cleanText(card.attr('data-bitrix-stage') || card.find('[data-bitrix-stage]').first().attr('data-bitrix-stage'));
  let raw = badge || attr;
  if (!raw) {
    const line = card.find('*').filter((__, el) => /стадия\s+в\s+битрикс/i.test($(el).text()) && $(el).children().length === 0).first().text();
    raw = cleanText(line || '');
  }
  return normalizeBitrixStageName(raw);
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
 * Cards on a status[] page are that order status. `.status-indicator` and
 * `data-order-status` are the logistics line status and must not drop the order.
 * Bitrix stage is applied separately from the card badge.
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
    const comment = cleanText(
      row.find('.custom_text_value, .product_text_value').first().attr('value')
      || row.attr('data-comment')
      || '',
    );
    items.push({ name, quantity, price, discount, comment });
  });
  return items;
}

function commentFromCells(cells, used) {
  for (const cell of cells) {
    if (!cell || used.has(cell)) continue;
    if (/^\d+([.,]\d+)?(\s*шт\.?)?$/i.test(cell)) continue;
    if (/^[\d\s.,%]+$/.test(cell)) continue;
    return cell;
  }
  return '';
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
    items.push({
      name,
      quantity,
      price,
      discount,
      comment: commentFromCells(rest, new Set([quantity, price, discount].filter(Boolean))),
    });
  });
  return items;
}

/** Same name rule as the old free-entry catalog rows: comment becomes the item name. */
export function prepareActPositions(positions) {
  return disambiguateDuplicateNames(
    (positions || []).map((item) => normalizeFreeEntryItem({
      ...item,
      comment: item.comment ?? '',
    })),
  );
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
  const rows = (positions || []).map((item) => {
    const freeEntry = item.isFreeEntry ? ' data-free-entry="1"' : '';
    return `<tr${freeEntry}><td>${esc(item.name)}</td><td>${esc(item.price || '')}</td><td>${esc(item.quantity || '')}</td><td>${esc(item.discount || '0')}</td></tr>`;
  }).join('');
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
  return { resp, html: bodyText(resp.data), url };
}

export async function fetchLogisticEvents(startDate, endDate) {
  const fallbacks = fallbackOrderStatuses();
  const probeCode = fallbacks[0]?.code || '2';
  const probe = await requestLogisticList(startDate, endDate, probeCode);
  const statuses = parseOrderStatusCodes(probe.html, fallbacks);

  const byId = new Map();
  const fetched = [];
  for (let index = 0; index < statuses.length; index += 1) {
    const status = statuses[index];
    const page = index === 0 && String(status.code) === String(probeCode)
      ? probe
      : await requestLogisticList(startDate, endDate, status.code);
    const orders = parseLogisticList(page.html, page.resp);
    let unique = 0;
    for (const order of orders) {
      if (byId.has(order.id)) continue;
      order.dealStatus = status.label;
      byId.set(order.id, order);
      unique += 1;
    }
    fetched.push({
      status: status.label,
      code: String(status.code),
      fetched: orders.length,
      unique,
    });
  }

  const combined = [...byId.values()];
  const { kept, dropped } = filterOrdersByBitrixStage(combined);
  console.log(
    `[logistics] fetched_per_status=${JSON.stringify(fetched)} ` +
    `kept_after_stage=${kept.length} ` +
    `dropped_by_stage=${JSON.stringify(droppedBitrixStageCounts(dropped))}`,
  );

  orderCache.clear();
  const events = selectLogisticEvents(kept, startDate, endDate);
  for (const event of events) {
    const order = kept.find((item) => String(item.id) === event.id);
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
  const positions = prepareActPositions(parseActPositions(html));
  if (!positions.length) {
    const hasTable = /<table\b/i.test(html) || /data-id=/i.test(html);
    console.warn(
      `[logistics] order ${eventId} act has no positions${hasTable ? '' : ' (no position table)'}`,
    );
  }
  const order = orderCache.get(String(eventId)) || { id: String(eventId), dealStatus: RESERVE_DEAL_STATUS };
  const paymentStatus = mapFactOfPayment(order.paymentText);
  if (isUnknownFactOfPayment(order.paymentText)) {
    console.warn(
      `[logistics] order ${eventId} unknown fact-of-payment "${cleanText(order.paymentText)}"; statusOplaty unchanged`,
    );
  }
  return {
    description: buildDescriptionHtml(order, positions),
    payments: null,
    paymentStatus,
  };
}
