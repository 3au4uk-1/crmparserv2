import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUS, isUnknownFactOfPayment, mapFactOfPayment } from '../src/services/payment-field-names.js';

describe('mapFactOfPayment', () => {
  it('maps Tony badge labels after case and whitespace normalization', () => {
    expect(mapFactOfPayment('Полная оплата')).toBe(PAYMENT_STATUS.PAID);
    expect(mapFactOfPayment('  ПОЛНАЯ   ОПЛАТА ')).toBe(PAYMENT_STATUS.PAID);
    expect(mapFactOfPayment('полная\u00a0оплата')).toBe(PAYMENT_STATUS.PAID);
    expect(mapFactOfPayment('перЁплата')).toBe(PAYMENT_STATUS.PAID);
    expect(mapFactOfPayment('Частичная оплата')).toBe(PAYMENT_STATUS.PREPAYMENT);
    expect(mapFactOfPayment('частичная  оплата')).toBe(PAYMENT_STATUS.PREPAYMENT);
    expect(mapFactOfPayment('Без оплаты')).toBe(PAYMENT_STATUS.NONE);
    expect(mapFactOfPayment('Переплата')).toBe(PAYMENT_STATUS.PAID);
    expect(mapFactOfPayment('пЕрЕплата')).toBe(PAYMENT_STATUS.PAID);
  });

  it('returns null for no information, blank, dash, and unknown text', () => {
    expect(mapFactOfPayment('Нет информации')).toBeNull();
    expect(mapFactOfPayment('нет  информации')).toBeNull();
    expect(mapFactOfPayment('')).toBeNull();
    expect(mapFactOfPayment('   ')).toBeNull();
    expect(mapFactOfPayment('-')).toBeNull();
    expect(mapFactOfPayment(null)).toBeNull();
    expect(mapFactOfPayment('что-то ещё')).toBeNull();
  });

  it('treats no-information and other unrecognized text as unknown, and blank as absent', () => {
    expect(isUnknownFactOfPayment('Нет информации')).toBe(true);
    expect(isUnknownFactOfPayment('что-то')).toBe(true);
    expect(isUnknownFactOfPayment('')).toBe(false);
    expect(isUnknownFactOfPayment('   ')).toBe(false);
    expect(isUnknownFactOfPayment('-')).toBe(false);
    expect(isUnknownFactOfPayment(null)).toBe(false);
    expect(isUnknownFactOfPayment('Полная оплата')).toBe(false);
  });
});
