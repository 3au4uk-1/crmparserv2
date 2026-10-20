export const PAYMENT_FIELDS = {
  amount: 'summaPostupleniy',
  status: 'statusOplaty',
};

/** Twenty SELECT enum values for calendar payment aggregate status. */
export const PAYMENT_STATUS = {
  NONE: 'NE_OPLACHENO',
  PREPAYMENT: 'PREDOPLATA',
  PAID: 'OPLACHENO_POLNOSTYU',
  REFUND: 'VOZVRAT',
};

export const PAYMENT_STATUS_LABELS = {
  [PAYMENT_STATUS.NONE]: 'Не оплачено',
  [PAYMENT_STATUS.PREPAYMENT]: 'Предоплата',
  [PAYMENT_STATUS.PAID]: 'Оплачено полностью',
  [PAYMENT_STATUS.REFUND]: 'Возврат',
};

/**
 * Tony `.fact-of-payment` labels → statusOplaty.
 * Переплата has no select option, so it uses the paid-in-full value.
 * «Нет информации» is not a status and must not overwrite a stored value.
 */
const FACT_OF_PAYMENT = {
  'полная оплата': PAYMENT_STATUS.PAID,
  'частичная оплата': PAYMENT_STATUS.PREPAYMENT,
  'без оплаты': PAYMENT_STATUS.NONE,
  'переплата': PAYMENT_STATUS.PAID,
};

export function normalizeFactOfPayment(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

export function mapFactOfPayment(value) {
  const label = normalizeFactOfPayment(value);
  if (!label || label === '-') return null;
  return FACT_OF_PAYMENT[label] || null;
}

export function isUnknownFactOfPayment(value) {
  const label = normalizeFactOfPayment(value);
  if (!label || label === '-') return false;
  return !Object.prototype.hasOwnProperty.call(FACT_OF_PAYMENT, label);
}

export const OPPORTUNITY_OBJECT_ID = '806bcba5-5967-477f-a989-06afd3ea1d24';
