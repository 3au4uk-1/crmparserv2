export function normalizePrintOrderName(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\wа-яё0-9 ]/gi, '')
    .trim();
}
