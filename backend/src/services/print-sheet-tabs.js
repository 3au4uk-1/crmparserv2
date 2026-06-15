const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function tabNameForDate(date) {
  return `${MONTHS_RU[date.getMonth()]} ${date.getFullYear()}`;
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function buildPrintSheetTabNames(closeDateInput, nowInput = new Date()) {
  const closeDate = closeDateInput ? new Date(closeDateInput) : nowInput;
  const now = new Date(nowInput);
  const candidates = [
    tabNameForDate(closeDate),
    tabNameForDate(addMonths(closeDate, -1)),
    tabNameForDate(now),
  ];
  return [...new Set(candidates)];
}
