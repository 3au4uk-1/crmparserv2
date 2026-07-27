export const ALLOWED_TIPS = ['PODRYAD', 'BANNERA', 'PROIZVODSTVO', 'PLENKA', 'RESTAVRACIYA'];

export const TIP_DETAIL_BY_TIP = {
  PLENKA: ['NASHI', 'NE_NASHI'],
  RESTAVRACIYA: ['NASHI', 'NE_NASHI'],
  BANNERA: ['KTO_EDET', 'YURA', 'MAGA', 'TOPILSKIY'],
  PODRYAD: ['GLAV_PRINT', 'PASHA_VINDER', 'ZARYA', 'LIZA_SUKNO', 'KUVALDIN_KLISHE', 'SVOE'],
  PROIZVODSTVO: ['ROLL_UP', 'POP_UP', 'PROMO_STOYKA', 'PROIZVODSTVO_DRUGOE'],
};

export const DEFAULT_TIP_DETAIL_BY_TIP = {
  BANNERA: 'KTO_EDET',
  PLENKA: 'NASHI',
};

export const TIP_DETAIL_LABELS = {
  KTO_EDET: 'кто едет?',
  NASHI: 'Наши',
  NE_NASHI: 'Не наши',
  YURA: 'Юра',
  MAGA: 'Мага',
  TOPILSKIY: 'Топильский',
  GLAV_PRINT: 'Глав принт',
  PASHA_VINDER: 'Паша виндер',
  ZARYA: 'Заря',
  LIZA_SUKNO: 'Лиза сукно',
  KUVALDIN_KLISHE: 'Кувалдин клише',
  SVOE: 'Своё',
  ROLL_UP: 'Ролл-ап',
  POP_UP: 'Поп-ап',
  PROMO_STOYKA: 'Промо-стойка',
  PROIZVODSTVO_DRUGOE: 'Другое',
};

export function isTipDetailValidForTip(tip, tipDetail) {
  if (!tipDetail) return true;
  if (!tip) return false;
  const allowed = TIP_DETAIL_BY_TIP[tip];
  return Boolean(allowed?.includes(tipDetail));
}

export function resolveTipDetail(rule) {
  const tip = rule.tip;
  const raw = rule.tipDetail ?? rule.tip_detail ?? null;
  if (raw && isTipDetailValidForTip(tip, raw)) return raw;
  return DEFAULT_TIP_DETAIL_BY_TIP[tip] ?? null;
}
