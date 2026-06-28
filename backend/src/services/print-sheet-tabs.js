import { CRM_TIMEZONE } from '../utils/crm-dates.js';

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

function moscowParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_TIMEZONE,
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  return { month, year };
}

export function buildCurrentMonthTabName(nowInput = new Date()) {
  const { month, year } = moscowParts(nowInput);
  return `${MONTHS_RU[month - 1]} ${year}`;
}
