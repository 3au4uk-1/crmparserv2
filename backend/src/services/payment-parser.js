import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { parsePrice } from './html-parser.js';
import { PAYMENT_STATUS } from './payment-field-names.js';

const INCOMING_STATUSES = new Set(['1', 'P']);
const REFUND_STATUSES = new Set(['R', 'R2']);
const STATUS_PRIORITY = { P: 4, 1: 3, R: 2, R2: 2, 0: 1, '': 0 };

export function readPaymentStatus($li) {
  const selected = $li.find('select.paystatus option[selected]').first().attr('value');
  if (selected != null && selected !== '') return selected;
  const val = $li.find('select.paystatus').val();
  return val != null ? String(val) : '0';
}

export function parsePaymentHistoryHtml(historyHtml) {
  if (!historyHtml || typeof historyHtml !== 'string') return [];

  const $ = cheerio.load(historyHtml);
  const payments = [];

  $('#payment-history > li, ul#payment-history li, li[data-payid]').each((_, el) => {
    const $li = $(el);
    if (!$li.attr('data-payid')) return;

    const amount = parsePrice($li.find('.paysum').first().text());
    if (amount == null) return;

    payments.push({
      payId: String($li.attr('data-payid')),
      typeId: $li.attr('data-typeid') || null,
      amount,
      date: $li.find('.paydate').val() || $li.find('.paydate').attr('value') || null,
      description: $li.find('.paydesc').text().trim(),
      status: readPaymentStatus($li),
    });
  });

  return payments;
}

export function aggregatePaymentStatus(rawStatus) {
  if (rawStatus === 'P') return PAYMENT_STATUS.PAID;
  if (rawStatus === '1') return PAYMENT_STATUS.PREPAYMENT;
  if (rawStatus === 'R' || rawStatus === 'R2') return PAYMENT_STATUS.REFUND;
  return PAYMENT_STATUS.NONE;
}

export function aggregatePayments(payments) {
  const list = Array.isArray(payments) ? payments : [];
  let bestRaw = '0';
  let amount = 0;

  for (const payment of list) {
    const status = payment.status || '0';
    if (INCOMING_STATUSES.has(status)) {
      amount += payment.amount || 0;
    }
    if ((STATUS_PRIORITY[status] ?? 0) > (STATUS_PRIORITY[bestRaw] ?? 0)) {
      bestRaw = status;
    }
  }

  const hasIncoming = amount > 0;
  let status = aggregatePaymentStatus(bestRaw);
  if (!hasIncoming && list.some((p) => REFUND_STATUSES.has(p.status))) {
    status = PAYMENT_STATUS.REFUND;
  }
  if (!hasIncoming && status === PAYMENT_STATUS.PREPAYMENT) {
    status = PAYMENT_STATUS.NONE;
  }

  return {
    payments: list,
    paymentCount: list.length,
    paymentAmount: hasIncoming ? amount : 0,
    paymentStatus: status,
  };
}

export function parseCalendarPayments(paymentsPayload) {
  const historyHtml = paymentsPayload?.history ?? '';
  return aggregatePayments(parsePaymentHistoryHtml(historyHtml));
}

export function paymentContentHash(aggregate) {
  const payload = {
    amount: aggregate.paymentAmount,
    status: aggregate.paymentStatus,
    count: aggregate.paymentCount,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function applyPaymentAggregateToDb(db, dealId, aggregate) {
  const hash = paymentContentHash(aggregate);
  db.prepare(`
    UPDATE deals SET
      payment_amount = ?, payment_status = ?, payment_count = ?, payment_hash = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    aggregate.paymentAmount,
    aggregate.paymentStatus,
    aggregate.paymentCount,
    hash,
    dealId
  );
  return hash;
}
