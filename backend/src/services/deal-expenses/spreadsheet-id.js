export function parseSpreadsheetId(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const m = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return '';
}
