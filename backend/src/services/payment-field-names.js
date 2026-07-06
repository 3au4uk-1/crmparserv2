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

export const OPPORTUNITY_OBJECT_ID = '806bcba5-5967-477f-a989-06afd3ea1d24';
