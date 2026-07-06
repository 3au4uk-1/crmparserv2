import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  aggregatePayments,
  parseCalendarPayments,
  parsePaymentHistoryHtml,
  paymentContentHash,
} from '../src/services/payment-parser.js';
import { PAYMENT_STATUS } from '../src/services/payment-field-names.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calendarHtmlPath = path.resolve(
  __dirname,
  '../../../Desktop/Календарь/Календарь событий.html'
);

const SAMPLE_HISTORY = `
<ul id="payment-history">
  <li data-payid="71390" data-typeid="1" class="list-group-item">
    <span class="paysum">235 752.00</span> (безнал)
    <input class="paydate" value="30-06-2026">
    <p class="paydesc">ПП 1 от 30.06.2026</p>
    <select name="paystatus" class="paystatus">
      <option value="0">-</option>
      <option value="1" selected>Предоплата</option>
      <option value="P">Оплачено полностью</option>
    </select>
  </li>
</ul>`;

describe('parsePaymentHistoryHtml', () => {
  it('parses amount, date, description and status from calendar HTML', () => {
    const payments = parsePaymentHistoryHtml(SAMPLE_HISTORY);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      payId: '71390',
      typeId: '1',
      amount: 235752,
      date: '30-06-2026',
      status: '1',
    });
    expect(payments[0].description).toContain('ПП 1');
  });

  it('parses saved calendar page fixture when available', () => {
    if (!fs.existsSync(calendarHtmlPath)) return;
    const html = fs.readFileSync(calendarHtmlPath, 'utf-8');
    const match = html.match(/<ul id="payment-history"[\s\S]*?<\/ul>/);
    if (!match) return;

    const payments = parsePaymentHistoryHtml(match[0]);
    expect(payments.length).toBeGreaterThan(0);
    expect(payments[0].amount).toBe(235752);
    expect(payments[0].status).toBe('1');
  });
});

describe('aggregatePayments', () => {
  it('sums incoming payments and picks best status', () => {
    const result = aggregatePayments([
      { amount: 100000, status: '1' },
      { amount: 135752, status: 'P' },
    ]);
    expect(result.paymentAmount).toBe(235752);
    expect(result.paymentStatus).toBe(PAYMENT_STATUS.PAID);
    expect(result.paymentCount).toBe(2);
  });

  it('excludes refunds from amount but keeps refund status when no incoming', () => {
    const result = aggregatePayments([{ amount: 50000, status: 'R' }]);
    expect(result.paymentAmount).toBe(0);
    expect(result.paymentStatus).toBe(PAYMENT_STATUS.REFUND);
  });

  it('returns none when no payments', () => {
    const result = aggregatePayments([]);
    expect(result.paymentAmount).toBe(0);
    expect(result.paymentStatus).toBe(PAYMENT_STATUS.NONE);
  });
});

describe('parseCalendarPayments', () => {
  it('reads payments.history payload', () => {
    const result = parseCalendarPayments({ history: SAMPLE_HISTORY });
    expect(result.paymentAmount).toBe(235752);
    expect(result.paymentStatus).toBe(PAYMENT_STATUS.PREPAYMENT);
  });

  it('paymentContentHash changes when aggregate changes', () => {
    const a = paymentContentHash({ paymentAmount: 100, paymentStatus: PAYMENT_STATUS.PREPAYMENT, paymentCount: 1 });
    const b = paymentContentHash({ paymentAmount: 200, paymentStatus: PAYMENT_STATUS.PAID, paymentCount: 2 });
    expect(a).not.toBe(b);
  });
});
